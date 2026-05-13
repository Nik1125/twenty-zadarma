import { CoreApiClient } from 'twenty-client-sdk/core';

// Match strategies (in priority order) used by /zadarma/call-enrichment.
//
// 1. correlationId  → idempotent join (vendor-side call ID)
// 2. start_ts       → fuzzy match by callStart ± window
// 3. end_ts         → fuzzy match by call end (callStart + duration ± window)
// 4. recent         → most recent unmatched call where clientNumber matches
//                     either party (toNumber or fromNumber) within window from now
//
// Direction-agnostic clientNumber lookup: the upstream adapter (e.g. Retell)
// reports `to_number` and `from_number` from its own perspective. For our
// outbound call the client is in `to_number`; for our inbound call the client
// is in `from_number`. Zadarma's `callLog.clientNumber` always holds the
// remote party's E.164 number. We OR-match against both Retell-side numbers
// so a single payload shape works for both directions — the time-window
// filter (applied in JS) keeps the match precise.
//
// All strategies optionally narrow by `requireExtensions` (filter to
// internalExtension IN [aiExtensions]) and `correlationId IS NULL` (so
// already-enriched rows are excluded — except in strategy 1 where we
// deliberately re-match for idempotency).

export type MatchInput = {
  correlationId?: string;
  fromNumber?: string; // E.164 with or without leading "+"
  toNumber?: string; // E.164 with or without leading "+"
  startTimestamp?: number; // epoch ms
  endTimestamp?: number; // epoch ms
  windowSeconds: number;
  requireExtensions: boolean;
  aiExtensions: string[];
};

export type MatchOutput =
  | { matched: true; callLogId: string; matchedBy: MatchedBy; offsetMs: number }
  | { matched: false; reason: string };

export type MatchedBy =
  | 'correlationId'
  | 'time-window-start'
  | 'time-window-end'
  | 'recent-fallback';

const e164NoPlus = (raw: string | undefined): string => {
  if (!raw) return '';
  return raw.replace(/\D+/g, '');
};

type CallLogCandidate = {
  id: string;
  callStart?: string | null;
  duration?: number | null;
  correlationId?: string | null;
  internalExtension?: string | null;
};

const fetchByCorrelationId = async (
  client: CoreApiClient,
  correlationId: string,
): Promise<CallLogCandidate | null> => {
  const res = (await client.query({
    callLogs: {
      __args: { filter: { correlationId: { eq: correlationId } }, first: 1 },
      edges: { node: { id: true, callStart: true, correlationId: true } },
    },
  })) as {
    callLogs?: { edges?: Array<{ node: CallLogCandidate }> };
  };
  return res.callLogs?.edges?.[0]?.node ?? null;
};

// Fetch fuzzy candidates: callLog rows whose `clientNumber` matches either
// the toNumber or the fromNumber (the remote party — see header comment for
// why), `correlationId IS NULL`, plus optional internalExtension filter via
// `in`. We over-fetch (PAGE_SIZE) and pick the closest by time delta in JS —
// Twenty's filter syntax doesn't support range queries
// (one-operator-per-field rule).
const PAGE_SIZE = 100;

const fetchFuzzyCandidates = async (
  client: CoreApiClient,
  toNumberE164: string,
  fromNumberE164: string,
  requireExtensions: boolean,
  aiExtensions: string[],
): Promise<CallLogCandidate[]> => {
  const clientNumberCandidates = Array.from(
    new Set([toNumberE164, fromNumberE164].filter((n) => n.length > 0)),
  );
  const filter: Record<string, unknown> = {
    clientNumber: { in: clientNumberCandidates },
    correlationId: { is: 'NULL' },
  };
  if (requireExtensions && aiExtensions.length > 0) {
    filter.internalExtension = { in: aiExtensions };
  }
  const res = (await client.query({
    callLogs: {
      __args: { filter, first: PAGE_SIZE },
      edges: {
        node: {
          id: true,
          callStart: true,
          duration: true,
          correlationId: true,
          internalExtension: true,
        },
      },
    },
  })) as { callLogs?: { edges?: Array<{ node: CallLogCandidate }> } };
  return (res.callLogs?.edges ?? []).map((e) => e.node);
};

const pickClosest = (
  candidates: CallLogCandidate[],
  targetMs: number,
  windowMs: number,
  refField: 'start' | 'end',
): { candidate: CallLogCandidate; offsetMs: number } | null => {
  let best: { candidate: CallLogCandidate; offsetMs: number } | null = null;
  for (const c of candidates) {
    if (!c.callStart) continue;
    const startMs = Date.parse(c.callStart);
    if (!Number.isFinite(startMs)) continue;
    const refMs =
      refField === 'start'
        ? startMs
        : startMs + (typeof c.duration === 'number' ? c.duration * 1000 : 0);
    const delta = Math.abs(refMs - targetMs);
    if (delta > windowMs) continue;
    if (!best || delta < best.offsetMs) {
      best = { candidate: c, offsetMs: delta };
    }
  }
  return best;
};

export const resolveCallLogMatch = async (
  client: CoreApiClient,
  input: MatchInput,
): Promise<MatchOutput> => {
  // Strategy 1: explicit correlationId (idempotent re-runs)
  if (input.correlationId) {
    const hit = await fetchByCorrelationId(client, input.correlationId);
    if (hit) {
      return {
        matched: true,
        callLogId: hit.id,
        matchedBy: 'correlationId',
        offsetMs: 0,
      };
    }
    // No record carries this correlationId yet — fall through to fuzzy so
    // first-time enrichment can still attach.
  }

  const toNumberE164 = e164NoPlus(input.toNumber);
  const fromNumberE164 = e164NoPlus(input.fromNumber);
  if (!toNumberE164 && !fromNumberE164) {
    return {
      matched: false,
      reason:
        'toNumber or fromNumber is required for fuzzy match (no correlationId hit)',
    };
  }

  const windowMs = input.windowSeconds * 1000;
  const candidates = await fetchFuzzyCandidates(
    client,
    toNumberE164,
    fromNumberE164,
    input.requireExtensions,
    input.aiExtensions,
  );

  // Strategy 2: by start_timestamp
  if (input.startTimestamp !== undefined) {
    const hit = pickClosest(candidates, input.startTimestamp, windowMs, 'start');
    if (hit) {
      return {
        matched: true,
        callLogId: hit.candidate.id,
        matchedBy: 'time-window-start',
        offsetMs: hit.offsetMs,
      };
    }
  }

  // Strategy 3: by end_timestamp
  if (input.endTimestamp !== undefined) {
    const hit = pickClosest(candidates, input.endTimestamp, windowMs, 'end');
    if (hit) {
      return {
        matched: true,
        callLogId: hit.candidate.id,
        matchedBy: 'time-window-end',
        offsetMs: hit.offsetMs,
      };
    }
  }

  // Strategy 4: recent fallback — pick most recent OUT to this number within
  // window from now. Only triggers when no timestamps provided at all.
  if (input.startTimestamp === undefined && input.endTimestamp === undefined) {
    const nowMs = Date.now();
    const hit = pickClosest(candidates, nowMs, windowMs, 'start');
    if (hit) {
      return {
        matched: true,
        callLogId: hit.candidate.id,
        matchedBy: 'recent-fallback',
        offsetMs: hit.offsetMs,
      };
    }
  }

  return { matched: false, reason: 'no callLog matched within window' };
};
