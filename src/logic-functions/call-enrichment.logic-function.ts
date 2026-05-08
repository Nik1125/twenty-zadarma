import { defineLogicFunction } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';
import { CoreApiClient } from 'twenty-client-sdk/core';

import { CALL_ENRICHMENT_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { parseAiExtensions } from 'src/modules/zadarma/utils/parse-ai-extensions';
import { resolveEnrichmentWindowSeconds } from 'src/modules/zadarma/utils/parse-enrichment-window';
import { resolveCallLogMatch } from 'src/modules/zadarma/utils/resolve-call-log-match';

// POST /zadarma/call-enrichment (Bearer)
//
// Vendor-agnostic enrichment endpoint. Receives a payload from any AI/CRM
// post-call analysis adapter (Retell via n8n, Vapi, etc.), resolves the
// matching callLog row, and updates structured AI metric fields on it.
//
// Vendor-raw debug (tool calls, latency stats, full transcript breakdown,
// recording URLs) is expected to live in a Note attached to the callLog
// via Twenty's `noteTargets` mechanism — created by the adapter on its own
// after this endpoint returns the callLogId.
//
// Idempotent: re-running with the same `match.correlationId` updates the
// same row (no 409 — adapter retries are safe).
//
// Status codes:
//   200 ok=true               match + update succeeded
//   200 ok=false (matched:false) for diagnostic — n8n adapter retries on this
//   400 invalid body shape

type Sentiment = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'UNKNOWN';

type EnrichmentBody = {
  match?: {
    correlationId?: string;
    fromNumber?: string;
    toNumber?: string;
    startTimestamp?: number;
    endTimestamp?: number;
    windowSeconds?: number;
    requireExtensions?: boolean;
  };
  data?: {
    aiVendor?: string;
    aiAgentName?: string;
    aiSentiment?: string; // accepts case-insensitive — normalised below
    aiSuccessful?: boolean;
    aiTransferred?: boolean;
    aiCost?: { amountMicros?: number; currencyCode?: string };
    correlationId?: string;
    transcript?: string;
    summary?: string;
    recordingUrl?: string;
  };
};

const SENTIMENT_VALUES: ReadonlySet<Sentiment> = new Set([
  'POSITIVE',
  'NEGATIVE',
  'NEUTRAL',
  'UNKNOWN',
]);

const normaliseSentiment = (raw: string | undefined): Sentiment | null => {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  return SENTIMENT_VALUES.has(upper as Sentiment) ? (upper as Sentiment) : null;
};

type EnrichmentResult = {
  ok: boolean;
  error?: string;
  matched?: boolean;
  matchedBy?: string;
  offsetMs?: number;
  callLogId?: string;
  reason?: string;
  elapsedMs?: number;
};

const handler = async (
  event: RoutePayload<EnrichmentBody>,
): Promise<EnrichmentResult> => {
  const startedAt = Date.now();
  const body = event.body ?? {};
  const match = body.match ?? {};
  const data = body.data ?? {};

  if (
    !match.correlationId &&
    !match.toNumber
  ) {
    return {
      ok: false,
      error: 'match.toNumber is required (or match.correlationId for idempotent re-runs)',
    };
  }

  const aiExtensions = parseAiExtensions(process.env.AI_EXTENSIONS);
  const requireExtensions =
    match.requireExtensions ?? (aiExtensions.length > 0);
  const windowSeconds = resolveEnrichmentWindowSeconds(match.windowSeconds);

  const client = new CoreApiClient();
  const matchResult = await resolveCallLogMatch(client, {
    correlationId: match.correlationId,
    fromNumber: match.fromNumber,
    toNumber: match.toNumber,
    startTimestamp: match.startTimestamp,
    endTimestamp: match.endTimestamp,
    windowSeconds,
    requireExtensions,
    aiExtensions,
  });

  if (!matchResult.matched) {
    console.log(
      `[call-enrichment] no match — reason="${matchResult.reason}" toNumber=${match.toNumber} corrId=${match.correlationId ?? '-'}`,
    );
    return {
      ok: true,
      matched: false,
      reason: matchResult.reason,
      elapsedMs: Date.now() - startedAt,
    };
  }

  // Build update payload — only include fields the caller actually provided.
  const updateData: Record<string, unknown> = {};
  if (data.aiVendor !== undefined) updateData.aiVendor = data.aiVendor;
  if (data.aiAgentName !== undefined) updateData.aiAgentName = data.aiAgentName;
  const sentiment = normaliseSentiment(data.aiSentiment);
  if (sentiment) updateData.aiSentiment = sentiment;
  if (typeof data.aiSuccessful === 'boolean') updateData.aiSuccessful = data.aiSuccessful;
  if (typeof data.aiTransferred === 'boolean') updateData.aiTransferred = data.aiTransferred;
  if (data.aiCost && typeof data.aiCost.amountMicros === 'number') {
    updateData.aiCost = {
      amountMicros: data.aiCost.amountMicros,
      currencyCode: data.aiCost.currencyCode ?? 'USD',
    };
  }
  // correlationId — prefer explicit `data.correlationId`, else fall back to
  // `match.correlationId` if provided (so adapters can pass it once).
  const correlationId = data.correlationId ?? match.correlationId;
  if (correlationId) updateData.correlationId = correlationId;
  // RICH_TEXT v2 fields expect { markdown: string } shape; wrap plain strings.
  if (typeof data.transcript === 'string') {
    updateData.transcript = { markdown: data.transcript };
  }
  if (typeof data.summary === 'string') {
    updateData.summary = { markdown: data.summary };
  }
  if (typeof data.recordingUrl === 'string' && data.recordingUrl.length > 0) {
    updateData.recording = {
      primaryLinkLabel: 'Recording',
      primaryLinkUrl: data.recordingUrl,
    };
  }

  if (Object.keys(updateData).length === 0) {
    return {
      ok: true,
      matched: true,
      callLogId: matchResult.callLogId,
      matchedBy: matchResult.matchedBy,
      offsetMs: matchResult.offsetMs,
      reason: 'matched but data was empty — no fields updated',
      elapsedMs: Date.now() - startedAt,
    };
  }

  await client.mutation({
    updateCallLog: {
      __args: { id: matchResult.callLogId, data: updateData },
      id: true,
    },
  });

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[call-enrichment] matched=${matchResult.matchedBy} callLog=${matchResult.callLogId} offsetMs=${matchResult.offsetMs} fields=${Object.keys(updateData).join(',')} elapsedMs=${elapsedMs}`,
  );

  return {
    ok: true,
    matched: true,
    callLogId: matchResult.callLogId,
    matchedBy: matchResult.matchedBy,
    offsetMs: matchResult.offsetMs,
    elapsedMs,
  };
};

export default defineLogicFunction({
  universalIdentifier: CALL_ENRICHMENT_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'call-enrichment',
  description:
    'Vendor-agnostic post-call enrichment: resolves a callLog by correlationId / phone+timestamp / recent fallback, updates AI metric fields. Idempotent. Designed for n8n adapters fronting Retell, Vapi, or any post-call analysis source.',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    path: '/zadarma/call-enrichment',
    httpMethod: 'POST',
    isAuthRequired: true,
    forwardedRequestHeaders: ['authorization'],
  },
});
