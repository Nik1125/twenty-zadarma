import { defineLogicFunction } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';
import { CoreApiClient } from 'twenty-client-sdk/core';

import {
  getRawBodyForSignature,
  verifyZadarmaWebhook,
} from 'src/modules/zadarma/connector/verify-webhook';
import { signZadarmaRequest } from 'src/modules/zadarma/connector/sign-request';
import { resolveCooldownUntilIso } from 'src/modules/zadarma/utils/active-call-lock';
import { sweepStaleCooldowns } from 'src/modules/zadarma/utils/sweep-stale-cooldowns';
import { deriveCallerType } from 'src/modules/zadarma/utils/derive-caller-type';
import { findLatestOpportunityIdForPerson } from 'src/modules/zadarma/utils/find-latest-opportunity-id';
import { findPersonIdByClientNumber } from 'src/modules/zadarma/utils/find-person-by-phone';
import { localToUtcIso } from 'src/modules/zadarma/utils/local-to-utc-iso';
import { normalizePhone } from 'src/modules/zadarma/utils/normalize-phone';
import { parseAiExtensions } from 'src/modules/zadarma/utils/parse-ai-extensions';

// Zadarma's webhook payload uses the cabinet's display timezone for
// `call_start` (a wall-clock string with no offset). The applicationVariable
// `ZADARMA_CABINET_TIMEZONE` (set in Settings → Zadarma) supplies the IANA tz
// for the conversion. If unset we cannot convert reliably — we omit callStart
// instead of guessing, to keep the data store correct.
const resolveCallStartIso = (
  rawCallStart: string | undefined,
): string | undefined => {
  if (!rawCallStart) return undefined;
  const cabinetTz = process.env.ZADARMA_CABINET_TIMEZONE?.trim();
  if (!cabinetTz) {
    console.warn(
      `[zadarma-pbx-webhook] ZADARMA_CABINET_TIMEZONE not set — omitting callStart for "${rawCallStart}". Set Cabinet timezone in Settings → Zadarma to enable accurate timestamps.`,
    );
    return undefined;
  }
  return localToUtcIso(rawCallStart, cabinetTz) ?? undefined;
};

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

// Direction = first 4 chars of pbx_call_id (verified against CSV export +
// live webhooks: `in_xxx` for inbound, `out_xxx` for outbound). The
// `internal` field is unreliable. Shared between NOTIFY_END and the
// active-call-lock NOTIFY_START path.
const inferClientNumber = (
  body: ZadarmaPbxEvent,
): { callType: CallType; clientNumber: string | null } => {
  const pbxCallId = body.pbx_call_id ?? '';
  const callType: CallType = pbxCallId.startsWith('out_') ? 'OUT' : 'IN';
  const callerNumber = normalizePhone(body.caller_id);
  const calledNumber = normalizePhone(body.called_did);
  const destinationNumber = normalizePhone(body.destination);
  const clientNumber =
    callType === 'IN'
      ? callerNumber
      : (destinationNumber ?? calledNumber);
  return { callType, clientNumber };
};

// Writes the dial-lock signal to Person. The App is the publisher; consumers
// (n8n / Retell / future click-to-call button) read activeCallStatus +
// activeCallCooldownUntil. No-op if personId could not be resolved.
const writePersonCalling = async (
  client: CoreApiClient,
  personId: string | null,
) => {
  if (!personId) return;
  await client.mutation({
    updatePerson: {
      __args: {
        id: personId,
        data: {
          activeCallStatus: 'CALLING',
          activeCallCooldownUntil: null,
        },
      },
      id: true,
    },
  });
};

// Sets COOLDOWN + activeCallCooldownUntil. The actual flip back to IDLE
// is handled by two complementary paths:
//   1. sweep-stale-cooldowns-cron (canonical) — fires every minute via
//      Twenty's cron worker, clears any expired cooldown across the
//      workspace.
//   2. sweepStaleCooldowns() at the top of handleNotifyEnd / handleNotifyStart
//      (defense-in-depth) — instant recovery if a call lands while a
//      cooldown is expiring, so we don't wait for the next minute boundary.
//
// We do NOT use setTimeout here. The Twenty App SDK's logic-function
// runtime spawns a fresh node child-process per invocation and calls
// process.exit(0) immediately after the handler resolves (see twenty-server
// `local.driver.ts` writeBootstrapRunner) — any timer queued inside the
// handler dies with the process. Cron is the only event-driven mechanism
// the SDK exposes for deferred work.
const writePersonCooldown = async (
  client: CoreApiClient,
  personId: string | null,
) => {
  if (!personId) return;
  const cooldownUntilIso = resolveCooldownUntilIso();
  await client.mutation({
    updatePerson: {
      __args: {
        id: personId,
        data: {
          activeCallStatus: 'COOLDOWN',
          activeCallCooldownUntil: cooldownUntilIso,
        },
      },
      id: true,
    },
  });
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

  const { callType, clientNumber } = inferClientNumber(body);
  const callerNumber = normalizePhone(body.caller_id);
  const calledNumber = normalizePhone(body.called_did);
  // For inbound:  caller_id = client (external),  called_did = our DID
  // For outbound: caller_id = our DID/extension,  destination = client (external)
  const ourNumber = callType === 'IN' ? calledNumber : callerNumber;

  const client = new CoreApiClient();
  // Safety net for stuck COOLDOWN rows whose deferred setTimeout never fired
  // (container restart, expired token in detached callback, etc). Self-heals
  // by sweeping any Person where activeCallCooldownUntil < now back to IDLE.
  // Best-effort — internal errors are swallowed; never blocks the primary
  // webhook flow.
  await sweepStaleCooldowns(client);

  let personId: string | null = null;
  if (clientNumber) {
    personId = await findPersonIdByClientNumber(client, clientNumber);
  }

  // Auto-create Person from unknown caller — only when (a) no Person was
  // matched by phone-suffix lookup, (b) we have a usable clientNumber,
  // (c) ZADARMA_AUTO_CREATE_PERSON applicationVariable is "true". The
  // newly-created Person triggers the standard `person.created` DB-event,
  // which (when TEAMSALE_BASE_URL is set) cascades into TeamSale-link
  // back-fill. Default off — most installations route inbound numbers
  // through their own n8n / FB-lead workflow before the webhook fires.
  if (!personId && clientNumber) {
    const autoCreate =
      (process.env.ZADARMA_AUTO_CREATE_PERSON ?? '').trim().toLowerCase() ===
      'true';
    if (autoCreate) {
      try {
        const created = (await client.mutation({
          createPerson: {
            __args: {
              data: {
                name: { firstName: '', lastName: clientNumber },
                phones: { primaryPhoneNumber: '+' + clientNumber },
              },
            },
            id: true,
          },
        })) as { createPerson?: { id: string } };
        personId = created.createPerson?.id ?? null;
        if (personId) {
          console.log(
            `[zadarma-pbx-webhook] NOTIFY_END auto-created personId=${personId} for unknown clientNumber=${clientNumber}`,
          );
        }
      } catch (err) {
        console.warn(
          `[zadarma-pbx-webhook] NOTIFY_END auto-create person failed for ${clientNumber}:`,
          err,
        );
      }
    }
  }

  const existingId = await findCallLogIdByPbxCallId(client, pbxCallId);
  const disposition = mapDisposition(body.disposition);
  const duration = parseDuration(body.duration);
  const callerType = deriveCallerType(
    body.internal,
    parseAiExtensions(process.env.AI_EXTENSIONS),
  );

  if (existingId) {
    await client.mutation({
      updateCallLog: {
        __args: {
          id: existingId,
          data: {
            duration,
            disposition,
            internalExtension: body.internal || null,
            callerType,
            ...(personId ? { personId } : {}),
          },
        },
        id: true,
      },
    });
    await writePersonCooldown(client, personId);
    console.log(
      `[zadarma-pbx-webhook] NOTIFY_END pbx=${pbxCallId} type=${callType} client=${clientNumber} dur=${duration} updated existing=${existingId} personId=${personId}`,
    );
    return { ok: true, action: 'updated', callLogId: existingId, personId };
  }

  // Auto-attach to the Person's most-recently-created opportunity (if any)
  // so fresh calls land on the deal the operator is currently working.
  // Null when the Person has no opportunities — the field stays empty.
  const opportunityId = await findLatestOpportunityIdForPerson(client, personId);

  const created = (await client.mutation({
    createCallLog: {
      __args: {
        data: {
          name: `${callType} ${clientNumber ?? '?'}${body.call_start ? ' — ' + body.call_start : ''}`,
          pbxCallId,
          callType,
          callStart: resolveCallStartIso(body.call_start),
          duration,
          disposition,
          clientNumber: clientNumber ?? '',
          ourNumber: ourNumber ?? '',
          internalExtension: body.internal || null,
          callerType,
          personId,
          ...(opportunityId ? { opportunityId } : {}),
        },
      },
      id: true,
    },
  })) as { createCallLog?: { id: string } };
  const callLogId = created.createCallLog?.id;
  await writePersonCooldown(client, personId);
  console.log(
    `[zadarma-pbx-webhook] NOTIFY_END pbx=${pbxCallId} type=${callType} client=${clientNumber} dur=${duration} created=${callLogId} personId=${personId} opportunityId=${opportunityId ?? '-'}`,
  );
  return { ok: true, action: 'created', callLogId, personId, opportunityId, matched: personId !== null };
};

// Active-call-lock publisher. Fires for NOTIFY_START (inbound), NOTIFY_OUT_START
// (outbound), and NOTIFY_INTERNAL (when a call is routed to an extension —
// some Zadarma deployments emit this in lieu of NOTIFY_START). Idempotent:
// re-firing on the same Person while already in 'calling' is harmless.
const handleNotifyStart = async (body: ZadarmaPbxEvent & Record<string, unknown>) => {
  const eventType = body.event ?? '(unknown)';
  console.log(
    `[zadarma-pbx-webhook] ${eventType} raw body: ${JSON.stringify(body)}`,
  );
  const pbxCallId = body.pbx_call_id;
  if (!pbxCallId) {
    return { ok: false, action: 'start-no-pbx-id', event: eventType };
  }

  const { callType, clientNumber } = inferClientNumber(body);
  if (!clientNumber) {
    return { ok: true, action: 'start-no-client-number', event: eventType, callType };
  }

  const client = new CoreApiClient();
  await sweepStaleCooldowns(client);
  const personId = await findPersonIdByClientNumber(client, clientNumber);
  if (!personId) {
    console.log(
      `[zadarma-pbx-webhook] ${eventType} pbx=${pbxCallId} type=${callType} client=${clientNumber} no person match — skip lock`,
    );
    return { ok: true, action: 'start-no-person-match', event: eventType };
  }

  await writePersonCalling(client, personId);
  console.log(
    `[zadarma-pbx-webhook] ${eventType} pbx=${pbxCallId} type=${callType} client=${clientNumber} personId=${personId} → activeCallStatus=calling`,
  );
  return { ok: true, action: 'start-lock-set', event: eventType, personId };
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
    // Persist call_id_with_rec to callLog.callId — same value Zadarma exposes
    // as the Asterisk channel id in /v1/statistics/pbx response. Required by
    // /v1/speech_recognition/ for transcript fetch; without it the transcript
    // backfill button silently fails for every call.
    await client.mutation({
      updateCallLog: {
        __args: {
          id: existingId,
          data: {
            ...(callIdWithRec ? { callId: callIdWithRec } : {}),
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
      `[zadarma-pbx-webhook] NOTIFY_RECORD attached direct link to callLog=${existingId} callId=${callIdWithRec ?? '-'}`,
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

  // Persist call_id_with_rec to callLog.callId — same value Zadarma exposes
  // as the Asterisk channel id in /v1/statistics/pbx response. Required by
  // /v1/speech_recognition/ for transcript fetch.
  await client.mutation({
    updateCallLog: {
      __args: {
        id: existingId,
        data: {
          callId: callIdWithRec,
          recording: {
            primaryLinkUrl: recordingLink,
            primaryLinkLabel: 'Recording',
          },
        },
      },
      id: true,
    },
  });
  console.log(
    `[zadarma-pbx-webhook] NOTIFY_RECORD attached link to callLog=${existingId} callId=${callIdWithRec}`,
  );
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
  if (
    eventType === 'NOTIFY_START' ||
    eventType === 'NOTIFY_OUT_START' ||
    eventType === 'NOTIFY_INTERNAL'
  ) {
    return handleNotifyStart(body);
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
