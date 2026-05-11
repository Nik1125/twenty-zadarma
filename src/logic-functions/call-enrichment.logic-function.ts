import { defineLogicFunction } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';
import { CoreApiClient } from 'twenty-client-sdk/core';

import { CALL_ENRICHMENT_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { formatMarkdownToBlocknote } from 'src/modules/shared/format-markdown-blocknote';
import {
  normaliseAction,
  normaliseInterestLevel,
  normaliseKeyFacts,
  normaliseKeyTopics,
  normaliseOutcome,
  normaliseScore,
  normaliseSentiment,
  pickEnrichmentKey,
} from 'src/modules/zadarma/utils/call-enrichment-normalisers';
import { parseAiExtensions } from 'src/modules/zadarma/utils/parse-ai-extensions';
import { resolveEnrichmentWindowSeconds } from 'src/modules/zadarma/utils/parse-enrichment-window';
import { resolveCallLogMatch } from 'src/modules/zadarma/utils/resolve-call-log-match';

// POST /zadarma/call-enrichment (Bearer)
//
// Vendor-agnostic enrichment endpoint. Receives a payload from any
// AI/CRM post-call analysis adapter (Retell via n8n, Vapi, manual LLM
// pipelines, etc.), resolves the matching callLog row, and updates the
// structured analysis fields on it.
//
// Schema as of v0.25.0: analysis fields are universal (no `ai` prefix)
// because they apply equally to AI-handled and manager-handled calls.
// `aiTranscript` / `aiVendor` / `aiAgentName` / `aiTransferred` / `aiCost`
// stay AI-prefixed — those are intrinsically vendor-specific.
//
// Dual-key payload acceptance: the endpoint reads both the new universal
// keys (`sentiment`, `interestLevel`, `actionRequired`, `actionContext`,
// `keyTopics`, `successful`) AND the legacy `ai*`-prefixed keys
// (`aiSentiment`, etc.) so adapters wired against v0.24 keep working
// without an update. When both are present in the same request the
// universal key wins; a one-shot deprecation warning logs the legacy
// key the first time it is seen per process.
//
// New v0.25 fields: `outcome` (8-value generic enum), `score` (1-5 manager
// performance, NULL = skipped), `scoreReason` (free-text justification or
// `skipped: <reason>`), and `keyFacts` (structured `[{type,value}]` pairs
// the Biography refresh workflow aggregates per Person).
//
// Idempotent: re-running with the same `match.correlationId` updates the
// same row.

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
    // Vendor-specific — no rename. Always written through as-is.
    aiVendor?: string;
    aiAgentName?: string;
    aiTransferred?: boolean;
    aiCost?: { amountMicros?: number; currencyCode?: string };
    correlationId?: string;
    aiTranscript?: string;
    summary?: string;   // new canonical key (matches the callLog column name)
    aiSummary?: string; // legacy v0.24 key, still accepted
    recordingUrl?: string;

    // Universal analysis — accept new keys + legacy `ai*` keys for
    // back-compat. New keys win when both present.
    sentiment?: string;
    aiSentiment?: string;
    successful?: boolean;
    aiSuccessful?: boolean;
    interestLevel?: number;
    aiInterestLevel?: number;
    actionRequired?: string;
    aiActionRequired?: string;
    actionContext?: string;
    aiActionContext?: string;
    keyTopics?: unknown;
    aiKeyTopics?: unknown;

    // NEW v0.25 universal fields (no legacy alias).
    outcome?: string;
    score?: number;
    scoreReason?: string;
    keyFacts?: unknown;
  };
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

  if (!match.correlationId && !match.toNumber) {
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

  // --- Vendor-specific (no rename, no dual-key) ---
  if (data.aiVendor !== undefined) updateData.aiVendor = data.aiVendor;
  if (data.aiAgentName !== undefined) updateData.aiAgentName = data.aiAgentName;
  if (typeof data.aiTransferred === 'boolean') {
    updateData.aiTransferred = data.aiTransferred;
  }
  if (data.aiCost && typeof data.aiCost.amountMicros === 'number') {
    updateData.aiCost = {
      amountMicros: data.aiCost.amountMicros,
      currencyCode: data.aiCost.currencyCode ?? 'USD',
    };
  }
  // correlationId — prefer explicit `data.correlationId`, else fall back
  // to `match.correlationId` so adapters can pass it once.
  const correlationId = data.correlationId ?? match.correlationId;
  if (correlationId) updateData.correlationId = correlationId;
  // RICH_TEXT v2 fields take both `{ markdown, blocknote }`. Markdown
  // alone renders as raw plaintext (visible `**` / `##`) until the
  // operator manually edits the field. Wrap every string write through
  // formatMarkdownToBlocknote so external adapters don't have to know.
  if (typeof data.aiTranscript === 'string') {
    updateData.aiTranscript = formatMarkdownToBlocknote(data.aiTranscript);
  }
  const summaryRaw = pickEnrichmentKey(
    data.summary,
    data.aiSummary,
    'aiSummary',
    'summary',
  );
  if (typeof summaryRaw === 'string') {
    updateData.summary = formatMarkdownToBlocknote(summaryRaw);
  }
  if (typeof data.recordingUrl === 'string' && data.recordingUrl.length > 0) {
    updateData.recording = {
      primaryLinkLabel: 'Recording',
      primaryLinkUrl: data.recordingUrl,
    };
  }

  // --- Universal (dual-key: new wins, legacy emits warning) ---
  const sentimentRaw = pickEnrichmentKey(
    data.sentiment,
    data.aiSentiment,
    'aiSentiment',
    'sentiment',
  );
  const sentiment = normaliseSentiment(sentimentRaw);
  if (sentiment) updateData.sentiment = sentiment;

  const successfulRaw = pickEnrichmentKey(
    data.successful,
    data.aiSuccessful,
    'aiSuccessful',
    'successful',
  );
  if (typeof successfulRaw === 'boolean') {
    updateData.successful = successfulRaw;
  }

  const interestLevelRaw = pickEnrichmentKey(
    data.interestLevel,
    data.aiInterestLevel,
    'aiInterestLevel',
    'interestLevel',
  );
  const interestLevel = normaliseInterestLevel(interestLevelRaw);
  if (interestLevel !== null) updateData.interestLevel = interestLevel;

  const actionRaw = pickEnrichmentKey(
    data.actionRequired,
    data.aiActionRequired,
    'aiActionRequired',
    'actionRequired',
  );
  const action = normaliseAction(actionRaw);
  if (action) updateData.actionRequired = action;

  const actionContextRaw = pickEnrichmentKey(
    data.actionContext,
    data.aiActionContext,
    'aiActionContext',
    'actionContext',
  );
  if (
    typeof actionContextRaw === 'string' &&
    actionContextRaw.trim().length > 0
  ) {
    updateData.actionContext = actionContextRaw.trim();
  }

  const keyTopicsRaw = pickEnrichmentKey(
    data.keyTopics,
    data.aiKeyTopics,
    'aiKeyTopics',
    'keyTopics',
  );
  const keyTopics = normaliseKeyTopics(keyTopicsRaw);
  if (keyTopics) updateData.keyTopics = keyTopics;

  // --- NEW v0.25 fields (no legacy alias) ---
  const outcome = normaliseOutcome(data.outcome);
  if (outcome) updateData.outcome = outcome;

  const score = normaliseScore(data.score);
  if (score !== null) updateData.score = score;

  if (typeof data.scoreReason === 'string' && data.scoreReason.trim().length > 0) {
    updateData.scoreReason = data.scoreReason.trim();
  }

  const keyFacts = normaliseKeyFacts(data.keyFacts);
  if (keyFacts) updateData.keyFacts = keyFacts;

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
    'Vendor-agnostic post-call enrichment: resolves a callLog by correlationId / phone+timestamp / recent fallback, updates structured analysis fields (sentiment, interestLevel, actionRequired, actionContext, keyTopics, successful, outcome, score, scoreReason, keyFacts, summary, aiTranscript, aiVendor, aiAgentName, aiTransferred, aiCost). Idempotent. Accepts both new (v0.25 universal) and legacy (v0.24 ai-prefixed) payload keys for graceful adapter migration.',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    path: '/zadarma/call-enrichment',
    httpMethod: 'POST',
    isAuthRequired: true,
    forwardedRequestHeaders: ['authorization'],
  },
});
