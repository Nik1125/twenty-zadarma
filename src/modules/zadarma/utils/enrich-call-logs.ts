import { type CoreApiClient } from 'twenty-client-sdk/core';

import { fetchCallRecordingLink } from 'src/modules/zadarma/utils/fetch-call-recording';
import { fetchCallTranscript } from 'src/modules/zadarma/utils/fetch-call-transcript';
import { formatTranscript } from 'src/modules/zadarma/utils/format-transcript-blocknote';

// Per-row enrichment loop shared between live sync (`sync-zadarma-calls`)
// and the backfill endpoint (`enrich-call-logs`). For each input row:
//   1. Skip if duration < MIN_DURATION_SECONDS (autoresponder / hangup / no
//      audio worth fetching).
//   2. Fetch recording link via /v1/pbx/record/request/?pbx_call_id=… —
//      always attempted (works even on legacy rows without callId).
//   3. Fetch transcript via /v1/speech_recognition/?call_id=… — only when
//      callId is known. Legacy rows without callId record the skip in
//      counters and continue.
//   4. Throttle THROTTLE_MS between row iterations to stay under Zadarma's
//      100 req/min global quota (we make 2 requests per row → ~50 rows/min
//      sustained).
//
// Per-row failures (HTTP error, parse error, mutation error) are logged
// and counted but never throw — one bad row should not abort enrichment of
// the rest of the batch.

export const MIN_DURATION_SECONDS = 10;
const THROTTLE_MS = 1_200;

export type EnrichInput = {
  id: string;
  pbxCallId: string;
  callId: string | null;
  duration: number | null;
  hasRecording: boolean;
  hasTranscript: boolean;
};

export type EnrichOpts = {
  userKey: string;
  secret: string;
  // Soft budget: stop iterating once elapsed >= this. Used by sync to keep
  // enrichment under the logic-function timeout. Set to null for "no limit".
  maxBudgetMs?: number | null;
  // Override for tests.
  throttleMs?: number;
};

export type EnrichResult = {
  processed: number;
  enrichedRecording: number;
  enrichedTranscript: number;
  skippedShort: number;
  skippedAlreadyDone: number;
  skippedNoCallId: number;
  transcriptInProgress: number;
  transcriptNotAvailable: number;
  recordingFailed: number;
  transcriptFailed: number;
  mutationFailed: number;
  budgetExceeded: number;
  elapsedMs: number;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const emptyResult = (): EnrichResult => ({
  processed: 0,
  enrichedRecording: 0,
  enrichedTranscript: 0,
  skippedShort: 0,
  skippedAlreadyDone: 0,
  skippedNoCallId: 0,
  transcriptInProgress: 0,
  transcriptNotAvailable: 0,
  recordingFailed: 0,
  transcriptFailed: 0,
  mutationFailed: 0,
  budgetExceeded: 0,
  elapsedMs: 0,
});

export const enrichCallLogs = async (
  client: CoreApiClient,
  rows: EnrichInput[],
  opts: EnrichOpts,
): Promise<EnrichResult> => {
  const result = emptyResult();
  const startedAt = Date.now();
  const throttleMs = opts.throttleMs ?? THROTTLE_MS;
  const budgetMs = opts.maxBudgetMs ?? null;

  for (let i = 0; i < rows.length; i++) {
    if (budgetMs !== null && Date.now() - startedAt >= budgetMs) {
      result.budgetExceeded = rows.length - i;
      break;
    }

    const row = rows[i];
    result.processed++;

    if (
      row.duration === null ||
      row.duration === undefined ||
      row.duration < MIN_DURATION_SECONDS
    ) {
      result.skippedShort++;
      continue;
    }

    const updates: Record<string, unknown> = {};

    if (!row.hasRecording) {
      const rec = await fetchCallRecordingLink({
        pbxCallId: row.pbxCallId,
        userKey: opts.userKey,
        secret: opts.secret,
      });
      if (rec.link) {
        updates.recording = {
          primaryLinkUrl: rec.link,
          primaryLinkLabel: 'Recording',
        };
      } else {
        result.recordingFailed++;
        console.warn(
          `[enrich-call-logs] recording fetch failed for ${row.pbxCallId}: ${rec.error}`,
        );
      }
    }

    if (!row.hasTranscript) {
      if (!row.callId) {
        result.skippedNoCallId++;
      } else {
        const tr = await fetchCallTranscript({
          callId: row.callId,
          userKey: opts.userKey,
          secret: opts.secret,
        });
        if (tr.status === 'recognized' && tr.turns && tr.turns.length > 0) {
          const { markdown, blocknote } = formatTranscript({
            turns: tr.turns,
            pbxCallId: row.pbxCallId,
          });
          updates.transcript = { markdown, blocknote };
        } else if (tr.status === 'in_progress') {
          result.transcriptInProgress++;
        } else if (
          tr.status === 'not_available' ||
          tr.status === 'ready_for_recognize'
        ) {
          result.transcriptNotAvailable++;
        } else {
          result.transcriptFailed++;
          console.warn(
            `[enrich-call-logs] transcript fetch ${row.callId}: status=${tr.status} error=${tr.error ?? 'none'}`,
          );
        }
      }
    } else {
      result.skippedAlreadyDone++;
    }

    if (Object.keys(updates).length > 0) {
      try {
        await client.mutation({
          updateCallLog: {
            __args: { id: row.id, data: updates },
            id: true,
          },
        });
        if (updates.recording) result.enrichedRecording++;
        if (updates.transcript) result.enrichedTranscript++;
      } catch (err) {
        result.mutationFailed++;
        console.warn(
          `[enrich-call-logs] updateCallLog ${row.id} failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // Throttle between rows. Skip on the last iteration.
    if (i < rows.length - 1 && throttleMs > 0) {
      await sleep(throttleMs);
    }
  }

  result.elapsedMs = Date.now() - startedAt;
  return result;
};
