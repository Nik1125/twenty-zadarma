import { defineLogicFunction } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';
import { CoreApiClient } from 'twenty-client-sdk/core';

import {
  getRawBodyForSignature,
  verifyZadarmaWebhook,
} from 'src/modules/zadarma/connector/verify-webhook';
import { signZadarmaRequest } from 'src/modules/zadarma/connector/sign-request';
import { findPersonIdByClientNumber } from 'src/modules/zadarma/utils/find-person-by-phone';
import { localToUtcIso } from 'src/modules/zadarma/utils/local-to-utc-iso';
import { normalizePhone } from 'src/modules/zadarma/utils/normalize-phone';

// Zadarma's webhook payload uses the cabinet's display timezone for
// `call_start`. Polish accounts default to Europe/Warsaw. If your account is
// configured for a different cabinet timezone, override via the
// ZADARMA_CABINET_TIMEZONE applicationVariable.
const ZADARMA_CABINET_TZ = process.env.ZADARMA_CABINET_TIMEZONE || 'Europe/Warsaw';

const REGISTERED_PATH = '/zadarma/pbx-webhook';

type ZadarmaPbxEvent = {
  event?: string;
  pbx_call_id?: string;
  caller_id?: string;
  called_did?: string;
  // Zadarma's PBX-terminal outbound calls use `destination` for the external
  // client number (mirrors the CSV stats export schema). We accept both names.
  destination?: string;
  internal?: string;
  disposition?: string;
  duration?: string | number;
  call_start?: string;
  zd_echo?: string;
  call_id_with_rec?: string;
};

type CallType = 'IN' | 'OUT';
type Disposition =
  | 'ANSWERED'
  | 'NO_ANSWER'
  | 'BUSY'
  | 'CANCEL'
  | 'CALL_FAILED';

const mapDisposition = (raw: string | undefined): Disposition | undefined => {
  if (raw === undefined || raw === null) return undefined;
  const v = raw.toLowerCase().trim();
  if (v === 'answered') return 'ANSWERED';
  if (v === 'no answer') return 'NO_ANSWER';
  if (v === 'busy') return 'BUSY';
  if (v === 'cancel') return 'CANCEL';
  if (v === 'failed' || v === 'call failed') return 'CALL_FAILED';
  return undefined;
};

const parseDuration = (d: string | number | undefined): number | undefined => {
  if (d === undefined || d === null) return undefined;
  const n = typeof d === 'number' ? d : parseInt(d, 10);
  return Number.isFinite(n) ? n : undefined;
};

const findCallLogIdByPbxCallId = async (
  client: CoreApiClient,
  pbxCallId: string,
): Promise<string | null> => {
  const res = (await client.query({
    callLogs: {
      __args: { filter: { pbxCallId: { eq: pbxCallId } } },
      edges: { node: { id: true } },
    },
  })) as { callLogs?: { edges?: Array<{ node: { id: string } }> } };
  return res.callLogs?.edges?.[0]?.node.id ?? null;
};

const handleNotifyEnd = async (body: ZadarmaPbxEvent & Record<string, unknown>) => {
  const pbxCallId = body.pbx_call_id;
  if (!pbxCallId) return { error: 'pbx_call_id missing in NOTIFY_END payload' };

  console.log(
    `[zadarma-pbx-webhook] NOTIFY_END raw body: ${JSON.stringify(body)}`,
  );

  // Direction = first 4 chars of Zadarma's pbx_call_id (verified against CSV
  // export and live webhooks: `in_xxx` for inbound, `out_xxx` for outbound).
  // The `internal` field is unreliable (empty for cancelled/failed inbound
  // and not a direction signal).
  const callType: CallType = pbxCallId.startsWith('out_') ? 'OUT' : 'IN';
  const callerNumber = normalizePhone(body.caller_id);
  const calledNumber = normalizePhone(body.called_did);
  // Outbound from PBX terminal uses `destination` for the client number (CSV
  // export confirms this). Falls back to called_did for older/edge cases.
  const destinationNumber = normalizePhone(body.destination);

  // For inbound:  caller_id = client (external),  called_did = our DID
  // For outbound: caller_id = our DID/extension,  destination = client (external)
  const clientNumber =
    callType === 'IN'
      ? callerNumber
      : (destinationNumber ?? calledNumber);
  const ourNumber = callType === 'IN' ? calledNumber : callerNumber;

  const client = new CoreApiClient();

  let personId: string | null = null;
  if (clientNumber) {
    personId = await findPersonIdByClientNumber(client, clientNumber);
  }

  const existingId = await findCallLogIdByPbxCallId(client, pbxCallId);
  const disposition = mapDisposition(body.disposition);
  const duration = parseDuration(body.duration);

  if (existingId) {
    await client.mutation({
      updateCallLog: {
        __args: {
          id: existingId,
          data: {
            duration,
            disposition,
            internalExtension: body.internal || null,
            ...(personId ? { personId } : {}),
          },
        },
        id: true,
      },
    });
    console.log(
      `[zadarma-pbx-webhook] NOTIFY_END pbx=${pbxCallId} type=${callType} client=${clientNumber} dur=${duration} updated existing=${existingId} personId=${personId}`,
    );
    return { ok: true, action: 'updated', callLogId: existingId, personId };
  }

  const created = (await client.mutation({
    createCallLog: {
      __args: {
        data: {
          name: `${callType} ${clientNumber ?? '?'}${body.call_start ? ' — ' + body.call_start : ''}`,
          pbxCallId,
          callType,
          callStart: localToUtcIso(body.call_start, ZADARMA_CABINET_TZ) ?? undefined,
          duration,
          disposition,
          clientNumber: clientNumber ?? '',
          ourNumber: ourNumber ?? '',
          internalExtension: body.internal || null,
          personId,
        },
      },
      id: true,
    },
  })) as { createCallLog?: { id: string } };
  const callLogId = created.createCallLog?.id;
  console.log(
    `[zadarma-pbx-webhook] NOTIFY_END pbx=${pbxCallId} type=${callType} client=${clientNumber} dur=${duration} created=${callLogId} personId=${personId}`,
  );
  return { ok: true, action: 'created', callLogId, personId, matched: personId !== null };
};

// On NOTIFY_RECORD, Zadarma supplies `call_id_with_rec` and we need to fetch
// the actual recording URL via /v1/pbx/record/request/?call_id=XXX. The URL
// in the response is short-lived (~1 month). We attach it to the existing
// callLog if one exists for this pbx_call_id.
type ZadarmaRecordResponse = {
  status?: string;
  link?: string;
  links?: string[];
};

const handleNotifyRecord = async (body: ZadarmaPbxEvent & Record<string, unknown>) => {
  console.log(
    `[zadarma-pbx-webhook] NOTIFY_RECORD raw body: ${JSON.stringify(body)}`,
  );
  const pbxCallId = body.pbx_call_id;
  const callIdWithRec = body.call_id_with_rec;

  // Some Zadarma deployments deliver the recording URL directly in the
  // NOTIFY_RECORD webhook (under fields like `audio_link` / `link`) — that
  // URL is long-lived. The /v1/pbx/record/request/ API alternative returns
  // a short-lived signed URL that expires within hours. Prefer the webhook
  // URL when present.
  const directLink =
    ((body as Record<string, unknown>)['audio_link'] as string | undefined) ??
    ((body as Record<string, unknown>)['link'] as string | undefined) ??
    ((body as Record<string, unknown>)['record_link'] as string | undefined) ??
    ((body as Record<string, unknown>)['url'] as string | undefined);

  if (directLink) {
    if (!pbxCallId) {
      return { ok: true, action: 'record-no-pbx-id', recordingLink: directLink };
    }
    const client = new CoreApiClient();
    const existingId = await findCallLogIdByPbxCallId(client, pbxCallId);
    if (!existingId) {
      console.warn(
        `[zadarma-pbx-webhook] NOTIFY_RECORD: no callLog for pbx_call_id=${pbxCallId} yet (direct link path)`,
      );
      return { ok: false, action: 'record-no-call-log' };
    }
    await client.mutation({
      updateCallLog: {
        __args: {
          id: existingId,
          data: {
            recording: {
              primaryLinkUrl: directLink,
              primaryLinkLabel: 'Recording',
            },
          },
        },
        id: true,
      },
    });
    console.log(
      `[zadarma-pbx-webhook] NOTIFY_RECORD attached direct link to callLog=${existingId}`,
    );
    return { ok: true, action: 'record-attached-direct', callLogId: existingId };
  }

  if (!callIdWithRec) {
    return { error: 'call_id_with_rec missing and no direct link in NOTIFY_RECORD payload' };
  }

  const userKey = process.env.ZADARMA_USER_KEY;
  const secret = process.env.ZADARMA_SECRET;
  if (!userKey || !secret) {
    console.warn('[zadarma-pbx-webhook] NOTIFY_RECORD: keys not set, skipping recording fetch');
    return { ok: true, action: 'record-skipped' };
  }

  const signed = signZadarmaRequest({
    method: '/v1/pbx/record/request/',
    // lifetime is in seconds — max allowed by Zadarma is 5_184_000 (60 days).
    // Default is 1800 (30 min) which is why the URL we used to store became
    // 404 within an hour. Request the maximum so the link survives in
    // callLog.recording for the whole retention window.
    params: { call_id: callIdWithRec, lifetime: 5_184_000 },
    userKey,
    secret,
    httpMethod: 'GET',
  });
  const response = await fetch(signed.url, { method: 'GET', headers: signed.headers });
  const data = (await response.json()) as ZadarmaRecordResponse;
  const recordingLink = data.link ?? data.links?.[0];

  if (!recordingLink || data.status !== 'success') {
    console.warn(
      `[zadarma-pbx-webhook] NOTIFY_RECORD fetch failed: status=${data.status} link=${!!recordingLink}`,
    );
    return { ok: false, action: 'record-fetch-failed' };
  }

  if (!pbxCallId) {
    return { ok: true, action: 'record-no-pbx-id', recordingLink };
  }

  const client = new CoreApiClient();
  const existingId = await findCallLogIdByPbxCallId(client, pbxCallId);
  if (!existingId) {
    console.warn(
      `[zadarma-pbx-webhook] NOTIFY_RECORD: no callLog for pbx_call_id=${pbxCallId} yet`,
    );
    return { ok: false, action: 'record-no-call-log' };
  }

  await client.mutation({
    updateCallLog: {
      __args: {
        id: existingId,
        data: {
          recording: {
            primaryLinkUrl: recordingLink,
            primaryLinkLabel: 'Recording',
          },
        },
      },
      id: true,
    },
  });
  console.log(`[zadarma-pbx-webhook] NOTIFY_RECORD attached link to callLog=${existingId}`);
  return { ok: true, action: 'record-attached', callLogId: existingId };
};

const handler = async (event: RoutePayload<ZadarmaPbxEvent>) => {
  const echo =
    event.queryStringParameters?.zd_echo ?? (event.body as ZadarmaPbxEvent | undefined)?.zd_echo;
  if (echo) return echo;

  const secret = process.env.ZADARMA_SECRET;
  const rawBody = getRawBodyForSignature(event);
  const requestPath = event.requestContext?.http?.path ?? REGISTERED_PATH;
  const authHeader =
    event.headers?.['authorization'] ?? event.headers?.['Authorization'];

  if (authHeader && secret) {
    const verification = verifyZadarmaWebhook({
      path: requestPath,
      rawBody,
      authHeader,
      secret,
    });
    if (!verification.ok) {
      console.warn(
        `[zadarma-pbx-webhook] signed request rejected: ${verification.reason}`,
      );
      return { error: 'invalid signature', reason: verification.reason };
    }
  }

  const body: ZadarmaPbxEvent = event.body ?? {};
  const eventType = body.event;

  if (eventType === 'NOTIFY_END' || eventType === 'NOTIFY_OUT_END') {
    return handleNotifyEnd(body);
  }
  if (eventType === 'NOTIFY_RECORD') {
    return handleNotifyRecord(body);
  }
  console.log(
    `[zadarma-pbx-webhook] event=${eventType ?? '(none)'} pbx_call_id=${body.pbx_call_id ?? ''} ack`,
  );
  return { ok: true, action: 'acknowledged', event: eventType };
};

export default defineLogicFunction({
  universalIdentifier: '3e6ddc2c-0c78-4ed0-af62-dc5e2dba0969',
  name: 'handle-zadarma-pbx-webhook',
  description: 'Receives Zadarma PBX call webhooks (NOTIFY_*) and writes callLogs',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    path: REGISTERED_PATH,
    httpMethod: 'POST',
    isAuthRequired: false,
    forwardedRequestHeaders: ['authorization', 'content-type'],
  },
});
