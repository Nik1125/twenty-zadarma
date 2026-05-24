import { defineLogicFunction } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';
import { CoreApiClient } from 'twenty-client-sdk/core';
import { MetadataApiClient } from 'twenty-client-sdk/metadata';

import { syncRecordingAudioBlock } from 'src/modules/zadarma/utils/attach-recording-audio';
import { INBOX_ICON_HAS, setInboxIcon } from 'src/modules/zadarma/utils/inbox-icon';
import { findLatestOpportunityIdForPerson } from 'src/modules/zadarma/utils/find-latest-opportunity-id';
import { findPersonIdByClientNumber } from 'src/modules/zadarma/utils/find-person-by-phone';
import { formatTranscript } from 'src/modules/zadarma/utils/format-transcript-blocknote';
import { normalizePhone } from 'src/modules/zadarma/utils/normalize-phone';
import { extractDialogTurns } from 'src/modules/zadarma/utils/parse-speech-recognition';

const REGISTERED_PATH = '/zadarma-event-webhook';

// Zadarma's "O zdarzeniach" / events webhook URL receives these event types
// (see PBX → Integrations → Notifications → "About events" channel in cabinet):
//   - SMS                 (inbound SMS — handled in step 5)
//   - SPEECH_RECOGNITION  (post-call transcript — handled here)
//   - NUMBER_LOOKUP, CALL_TRACKING, DOCUMENT (acknowledged, no action)
type ZadarmaEventPayload = {
  event?: string;
  pbx_call_id?: string;
  call_id?: string;
  // Both SPEECH_RECOGNITION and SMS wrap their data in a JSON-encoded `result`
  // field (parsed inside the respective handler).
  result?: string | Record<string, unknown>;
  text?: string;
  language?: string;
  audio_link?: string;
  zd_echo?: string;
};

type CallLogLookup = {
  id: string;
  recordingUrl: string | null;
  recordingLabel: string | null;
};

// Matches by EITHER `pbxCallId` (e.g. "out_e8ddf618…") OR `callId`
// (Asterisk channel id, e.g. "1778596794.4673400"). Zadarma's
// SPEECH_RECOGNITION push webhook is inconsistent — sometimes it carries
// `body.pbx_call_id` (matches our pbxCallId column), sometimes only
// `body.call_id` (which is the Asterisk channel id stored in our
// callId column). The polling endpoint `/v1/speech_recognition/?call_id=…`
// always uses the Asterisk id. We accept both id flavours so a push
// payload of either shape lands on the right callLog.
const findCallLogByEventId = async (
  client: CoreApiClient,
  candidateIds: string[],
): Promise<CallLogLookup | null> => {
  const ids = candidateIds.filter((id) => typeof id === 'string' && id.length > 0);
  if (ids.length === 0) return null;
  const res = (await client.query({
    callLogs: {
      __args: {
        filter: {
          or: [
            { pbxCallId: { in: ids } },
            { callId: { in: ids } },
          ],
        },
      },
      edges: {
        node: {
          id: true,
          recording: { primaryLinkUrl: true, primaryLinkLabel: true },
        },
      },
    },
  })) as {
    callLogs?: {
      edges?: Array<{
        node: {
          id: string;
          recording?: {
            primaryLinkUrl?: string | null;
            primaryLinkLabel?: string | null;
          } | null;
        };
      }>;
    };
  };
  const node = res.callLogs?.edges?.[0]?.node;
  if (!node) return null;
  return {
    id: node.id,
    recordingUrl: node.recording?.primaryLinkUrl ?? null,
    recordingLabel: node.recording?.primaryLinkLabel ?? null,
  };
};

// SPEECH_RECOGNITION transcript shape + parser live in
// `parse-speech-recognition.ts` so the polling endpoint
// (`fetch-speech-transcript`) can reuse them. For stereo: outbound calls put
// OUR side on channel 1, inbound on channel 2 (heuristic verified on the
// user's Zadarma DID). The `formatTranscript` helper labels segments
// accordingly so RICH_TEXT renders as a readable dialog.

const handleSpeechRecognition = async (body: ZadarmaEventPayload & Record<string, unknown>) => {
  // Zadarma SR push payload may include `pbx_call_id` (matches our
  // pbxCallId column), `call_id` (Asterisk channel id stored in our
  // callId column), or — observed empirically — only one of the two.
  // Collect every candidate so the lookup tries both columns.
  const pbxCallIdRaw = typeof body.pbx_call_id === 'string' ? body.pbx_call_id : null;
  const callIdRaw = typeof body.call_id === 'string' ? body.call_id : null;
  const lookupIds = [pbxCallIdRaw, callIdRaw].filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  );
  console.log(
    `[zadarma-event-webhook] SPEECH_RECOGNITION raw body: ${JSON.stringify(body)}`,
  );
  const turns =
    lookupIds.length > 0
      ? extractDialogTurns((body as Record<string, unknown>).result)
      : null;

  if (lookupIds.length === 0 || !turns || turns.length === 0) {
    console.warn(
      `[zadarma-event-webhook] SPEECH_RECOGNITION missing pbx_call_id+call_id (pbx=${pbxCallIdRaw}, call=${callIdRaw}) or empty turns (${turns?.length ?? 'null'})`,
    );
    return { ok: false, error: 'missing pbx_call_id+call_id or empty turns' };
  }

  const client = new CoreApiClient();
  const callLog = await findCallLogByEventId(client, lookupIds);
  if (!callLog) {
    console.warn(
      `[zadarma-event-webhook] SPEECH_RECOGNITION: no callLog matched (pbx=${pbxCallIdRaw}, call=${callIdRaw})`,
    );
    return { ok: false, error: 'callLog not found' };
  }

  const { markdown, blocknote } = formatTranscript({
    turns,
    pbxCallId: pbxCallIdRaw ?? callIdRaw ?? '',
  });

  await client.mutation({
    updateCallLog: {
      __args: {
        id: callLog.id,
        data: {
          transcript: { markdown, blocknote },
        },
      },
      id: true,
    },
  });
  console.log(
    `[zadarma-event-webhook] SPEECH_RECOGNITION attached transcript (${markdown.length} chars, ${turns.length} turns) to callLog=${callLog.id}`,
  );
  // Embed the recording player at the top of the transcript (GDPR: link only,
  // no copy). Best-effort — never fail the transcript write.
  try {
    await syncRecordingAudioBlock(client, callLog.id);
  } catch (err) {
    console.warn(
      `[zadarma-event-webhook] recording audio embed failed for ${callLog.id}:`,
      err,
    );
  }
  return {
    ok: true,
    action: 'transcript-attached',
    callLogId: callLog.id,
    length: markdown.length,
    turns: turns.length,
  };
};

type ZadarmaInboundSmsResult = {
  caller_did?: string;
  caller_id?: string;
  text?: string;
};

const handleInboundSms = async (
  body: ZadarmaEventPayload & Record<string, unknown>,
) => {
  console.log(
    `[zadarma-event-webhook] SMS raw body: ${JSON.stringify(body)}`,
  );

  // Zadarma wraps SMS data in a JSON-encoded `result` field (same shape as
  // SPEECH_RECOGNITION). Parse it. Verified payload:
  //   { event: "SMS", result: "{\"caller_did\":\"<our>\",\"caller_id\":\"<client>\",\"text\":\"<body>\"}" }
  let inner: ZadarmaInboundSmsResult = {};
  const rawResult = body.result;
  if (typeof rawResult === 'string') {
    try {
      inner = JSON.parse(rawResult) as ZadarmaInboundSmsResult;
    } catch {
      inner = {};
    }
  } else if (rawResult && typeof rawResult === 'object') {
    inner = rawResult as ZadarmaInboundSmsResult;
  }

  const clientRaw = inner.caller_id;
  const ourRaw = inner.caller_did;
  const text = inner.text;

  if (!clientRaw || !text) {
    console.warn(
      `[zadarma-event-webhook] SMS missing required fields (client=${clientRaw}, text=${text ? 'set' : 'empty'})`,
    );
    return { ok: false, error: 'missing required SMS fields' };
  }

  const clientNumber = normalizePhone(clientRaw) ?? '';
  const ourNumber = normalizePhone(ourRaw) ?? '';

  // Zadarma doesn't supply a unique message ID for inbound SMS — synthesise
  // one so smsLog.messageId stays unique. Use timestamp+client to make it
  // idempotent within the same second (good enough for retry windows).
  const messageId = `inbound-${clientNumber}-${Date.now()}`;

  const client = new CoreApiClient();

  let personId: string | null = null;
  if (clientNumber) {
    personId = await findPersonIdByClientNumber(client, clientNumber);
  }
  // Auto-attach to the Person's most-recently-created opportunity (if any)
  // so inbound SMS lands on the active deal alongside calls.
  const opportunityId = await findLatestOpportunityIdForPerson(client, personId);

  const created = (await client.mutation({
    createSmsLog: {
      __args: {
        data: {
          name: `IN ${clientNumber || '?'}`,
          messageId,
          direction: 'IN',
          status: 'SUCCESS',
          sentAt: new Date().toISOString(),
          clientNumber,
          ourNumber,
          body: text,
          personId,
          ...(opportunityId ? { opportunityId } : {}),
          // Tag inbound rows so analytics can split inbound/outbound by
          // source. category stays at its OTHER default — n8n LLM
          // classifier may PATCH it to a more specific value later.
          source: 'INBOUND',
        },
      },
      id: true,
    },
  })) as { createSmsLog?: { id: string } };

  const smsLogId = created.createSmsLog?.id;

  // A fresh inbound SMS is by definition unanswered, so flip the Zadarma Inbox
  // command icon to its "has unanswered" state. No scan needed (we know the
  // count is ≥1); setInboxIcon is a no-op if already in that state. Best
  // effort — a metadata hiccup must never fail webhook ingestion.
  try {
    await setInboxIcon(new MetadataApiClient(), INBOX_ICON_HAS);
  } catch (err) {
    console.error('[zadarma-event-webhook] inbox icon set failed:', err);
  }

  console.log(
    `[zadarma-event-webhook] SMS inbound messageId=${messageId} client=${clientNumber} created=${smsLogId} personId=${personId} opportunityId=${opportunityId ?? '-'}`,
  );
  return { ok: true, action: 'created', smsLogId, personId, opportunityId };
};

const handler = async (event: RoutePayload<ZadarmaEventPayload>) => {
  const echo =
    event.queryStringParameters?.zd_echo ?? (event.body as ZadarmaEventPayload | undefined)?.zd_echo;
  if (echo) return echo;

  const body: ZadarmaEventPayload = event.body ?? {};
  const eventType = body.event;

  if (eventType === 'SPEECH_RECOGNITION') {
    if (process.env.ZADARMA_TRANSCRIPT_ENABLED === 'false') {
      console.log('[zadarma-event-webhook] SPEECH_RECOGNITION skipped: ZADARMA_TRANSCRIPT_ENABLED=false');
      return { ok: true, action: 'transcript-disabled' };
    }
    return handleSpeechRecognition(body);
  }
  if (eventType === 'SMS') {
    return handleInboundSms(body as ZadarmaEventPayload & Record<string, unknown>);
  }
  console.log(
    `[zadarma-event-webhook] event=${eventType ?? '(none)'} raw body: ${JSON.stringify(body)}`,
  );
  return { ok: true, action: 'acknowledged', event: eventType };
};

export default defineLogicFunction({
  universalIdentifier: '9060b5e4-4a1b-49a7-b9f2-09ff3955cbaa',
  name: 'handle-zadarma-event-webhook',
  description:
    'Receives Zadarma "About events" webhooks (SPEECH_RECOGNITION, SMS, lookups) — currently writes transcripts to callLog',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    path: REGISTERED_PATH,
    httpMethod: 'POST',
    isAuthRequired: false,
    forwardedRequestHeaders: ['authorization', 'content-type'],
  },
});
