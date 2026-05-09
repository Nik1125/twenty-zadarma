import { defineLogicFunction } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';
import { CoreApiClient } from 'twenty-client-sdk/core';

import { ENRICH_CALL_LOGS_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import {
  enrichCallLogs,
  MIN_DURATION_SECONDS,
  type EnrichInput,
  type EnrichResult,
} from 'src/modules/zadarma/utils/enrich-call-logs';

// Backfill endpoint. Enriches existing callLog rows that lack `recording`
// and / or `transcript` — typically rows synced before v0.17.0 (when
// enrichment was added to sync-zadarma-calls), or rows whose initial
// enrichment was deferred (sync's per-run budget exceeded).
//
// Body (all optional):
//   { limit?: number }   default 100; max 250.
//
// Strategy:
//   1. Page newest-first through callLogs with duration >= 10 s.
//   2. Drop rows that already have BOTH recording.primaryLinkUrl and
//      transcript.markdown populated.
//   3. Take up to `limit` rows that need work.
//   4. Hand them to the shared enrichCallLogs() loop.
//
// The endpoint is idempotent: re-running it processes whatever still
// needs work. Click repeatedly until `pickedForEnrichment === 0`.

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 250;
const SCAN_PAGE_SIZE = 200;

type EnrichBody = { limit?: number };

type CallLogScanRow = {
  id: string;
  pbxCallId?: string | null;
  callId?: string | null;
  duration?: number | null;
  recording?: { primaryLinkUrl?: string | null } | null;
  transcript?: { markdown?: string | null } | null;
};

const isNonEmptyString = (v: string | null | undefined): boolean =>
  typeof v === 'string' && v.length > 0;

const handler = async (event: RoutePayload<EnrichBody>) => {
  const userKey = process.env.ZADARMA_USER_KEY;
  const secret = process.env.ZADARMA_SECRET;
  if (!userKey || !secret) {
    return {
      ok: false,
      error: 'ZADARMA_USER_KEY / ZADARMA_SECRET not set in Settings',
    };
  }

  const requestedLimit = event.body?.limit;
  const limit =
    typeof requestedLimit === 'number' && requestedLimit > 0
      ? Math.min(Math.floor(requestedLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;

  const client = new CoreApiClient();

  const inputs: EnrichInput[] = [];
  let scanned = 0;
  let after: string | null | undefined = undefined;
  let hasMore = true;

  // Page until we have `limit` rows that need enrichment, or run out of
  // candidates. Newest-first is friendlier when the user is reactively
  // backfilling around recent recordings; legacy syncs that need to walk
  // a long tail can call repeatedly.
  while (inputs.length < limit && hasMore) {
    const res = (await client.query({
      callLogs: {
        __args: {
          filter: { duration: { gte: MIN_DURATION_SECONDS } },
          orderBy: [{ callStart: 'DescNullsLast' }],
          first: SCAN_PAGE_SIZE,
          ...(after ? { after } : {}),
        },
        edges: {
          node: {
            id: true,
            pbxCallId: true,
            callId: true,
            duration: true,
            recording: { primaryLinkUrl: true },
            transcript: { markdown: true },
          },
        },
        pageInfo: { hasNextPage: true, endCursor: true },
      },
    })) as {
      callLogs?: {
        edges?: Array<{ node: CallLogScanRow }>;
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
      };
    };
    const edges = res.callLogs?.edges ?? [];
    scanned += edges.length;

    for (const { node } of edges) {
      if (inputs.length >= limit) break;
      const hasRecording = isNonEmptyString(node.recording?.primaryLinkUrl);
      const hasTranscript = isNonEmptyString(node.transcript?.markdown);
      if (hasRecording && hasTranscript) continue;
      if (!node.pbxCallId) continue;
      inputs.push({
        id: node.id,
        pbxCallId: node.pbxCallId,
        callId: node.callId ?? null,
        duration: node.duration ?? null,
        hasRecording,
        hasTranscript,
      });
    }

    hasMore = res.callLogs?.pageInfo?.hasNextPage === true;
    after = res.callLogs?.pageInfo?.endCursor;
    if (!after) hasMore = false;
  }

  if (inputs.length === 0) {
    console.log(
      `[enrich-call-logs] no rows need enrichment (scanned=${scanned})`,
    );
    return {
      ok: true,
      scanned,
      pickedForEnrichment: 0,
      enrichment: null,
    };
  }

  console.log(
    `[enrich-call-logs] starting enrichment scanned=${scanned} picked=${inputs.length} limit=${limit}`,
  );
  const enrichment: EnrichResult = await enrichCallLogs(client, inputs, {
    userKey,
    secret,
  });
  console.log(
    `[enrich-call-logs] DONE processed=${enrichment.processed}/${inputs.length} rec=${enrichment.enrichedRecording} tr=${enrichment.enrichedTranscript} skippedShort=${enrichment.skippedShort} skippedNoCallId=${enrichment.skippedNoCallId} budgetExceeded=${enrichment.budgetExceeded} elapsed=${enrichment.elapsedMs}ms`,
  );

  return {
    ok: true,
    scanned,
    pickedForEnrichment: inputs.length,
    enrichment,
  };
};

export default defineLogicFunction({
  universalIdentifier: ENRICH_CALL_LOGS_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'enrich-call-logs',
  description:
    'Backfills callLog.recording (Zadarma signed URL) and callLog.transcript for existing rows that lack them. Skips rows with duration < 10 s. Transcript backfill requires callLog.callId (Asterisk channel id) — legacy rows without it get only the recording.',
  timeoutSeconds: 300,
  handler,
  httpRouteTriggerSettings: {
    path: '/zadarma/enrich-call-logs',
    httpMethod: 'POST',
    isAuthRequired: true,
    forwardedRequestHeaders: ['authorization'],
  },
});
