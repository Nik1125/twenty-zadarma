import { defineLogicFunction } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';
import { CoreApiClient } from 'twenty-client-sdk/core';

import { RECOMPUTE_COSTS_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import {
  computeCallCostFromRate,
  costsEqual,
  parseCostRatesFromEnv,
} from 'src/modules/zadarma/utils/compute-call-cost-from-rate';

// Recomputes `callLog.cost` for every chargeable row using the current
// rate-per-minute applicationVariables (ZADARMA_RATE_PER_MINUTE,
// ZADARMA_RATE_CURRENCY, AI_RATE_PER_MINUTE, AI_RATE_CURRENCY) ×
// `duration / 60`. Outbound rows + AI-handled inbound rows are chargeable;
// non-AI inbound rows keep cost=null (the called party pays on Zadarma's
// inbound side, and there is no agent cost to bill).
//
// Idempotent: skip-if-unchanged means re-running is cheap and the only
// rows touched are those whose stored cost actually differs from the new
// computed value. Run this whenever rates change.
//
// Body (all optional):
//   { limit?: number }   default 250; max 500.
//   { onlyMissing?: boolean } default true. When true, the candidate scan
//                             pre-filters by `cost.amountMicros IS NULL`.
//                             Set to false to refresh ALL outbound rows
//                             (e.g. after a rate change).
//   { fromIso?, toIso? }  optional callStart bounds. When the workspace has
//                         >~2k missing-cost rows the unfiltered scan hits
//                         Twenty's deep-pagination cap before reaching the
//                         oldest rows — the UI splits the universe into
//                         month-sized chunks and passes the bounds here so
//                         each chunk resets cursor pagination from scratch.
//                         Range filter is built as
//                         `and: [{ callStart: { gte } }, { callStart: { lte } }]`
//                         because Twenty rejects multi-operator-per-field
//                         (`{ callStart: { gte, lte } }` returns 500).
//
// Strategy: page newest-first through OUT callLogs (optionally filtered to
// `cost IS NULL` and bounded to a callStart range), batch updateCallLog
// 10-at-a-time, return counters + remaining-page hint so the UI can show
// "click again to continue" until the message reads "Nothing to update".

const DEFAULT_LIMIT = 250;
const MAX_LIMIT = 500;
const PAGE_SIZE = 200;
const MUTATION_BATCH = 10;

type RecomputeBody = {
  limit?: number;
  onlyMissing?: boolean;
  fromIso?: string;
  toIso?: string;
};

type CallLogRow = {
  id: string;
  callType: 'IN' | 'OUT' | null;
  callerType: 'HUMAN' | 'AI' | 'UNKNOWN' | null;
  duration: number | null;
  cost?: { amountMicros?: number | null; currencyCode?: string | null } | null;
};

type RecomputeResult = {
  ok: boolean;
  error?: string;
  scanned: number;
  picked: number;
  updated: number;
  unchanged: number;
  cleared: number;
  failed: number;
  hasMore: boolean;
  elapsedMs: number;
};

const handler = async (
  event: RoutePayload<RecomputeBody>,
): Promise<RecomputeResult> => {
  const startedAt = Date.now();
  const rates = parseCostRatesFromEnv({
    ZADARMA_RATE_PER_MINUTE: process.env.ZADARMA_RATE_PER_MINUTE,
    ZADARMA_RATE_CURRENCY: process.env.ZADARMA_RATE_CURRENCY,
    AI_RATE_PER_MINUTE: process.env.AI_RATE_PER_MINUTE,
    AI_RATE_CURRENCY: process.env.AI_RATE_CURRENCY,
    MIN_CHARGEABLE_DURATION_SECONDS: process.env.MIN_CHARGEABLE_DURATION_SECONDS,
  });
  const ratesConfigured =
    (rates.zadarmaRatePerMinute !== null && rates.zadarmaCurrency !== null) ||
    (rates.aiRatePerMinute !== null && rates.aiCurrency !== null);

  const requestedLimit = event.body?.limit;
  const limit =
    typeof requestedLimit === 'number' && requestedLimit > 0
      ? Math.min(Math.floor(requestedLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;

  // Default to onlyMissing=true so the common operator-flow ("Recompute all
  // costs" button after upgrading or after setting rates for the first
  // time) drains every row that has no cost. Cursor pagination in Twenty
  // caps scan depth, so the no-filter path can leave older nulls behind.
  const onlyMissing = event.body?.onlyMissing !== false;
  const fromIso = typeof event.body?.fromIso === 'string' ? event.body.fromIso : undefined;
  const toIso = typeof event.body?.toIso === 'string' ? event.body.toIso : undefined;

  const client = new CoreApiClient();

  const candidates: CallLogRow[] = [];
  let scanned = 0;
  let after: string | null | undefined = undefined;
  let hasNextPageInScan = true;

  // Page newest-first through chargeable rows. We pick at most `limit` rows
  // that need a write (computed cost differs from stored). The first page
  // that doesn't fill the picker is good enough — we don't try to paginate
  // until we hit `limit`, since rate changes typically affect every row
  // and the picker fills on the first page anyway.
  while (candidates.length < limit && hasNextPageInScan) {
    // Build filter — date bounds (when present) live in an `and:` array
    // because Twenty rejects multiple operators on the same field in one
    // object (`{ callStart: { gte, lte } }` returns 500). The
    // duration:gte threshold narrows the scan universe to rows that
    // could actually be charged — without it, short answered calls
    // dominate every page (computed=null, costsEqual(null,null)=true,
    // unchanged) and waste pagination budget. With the threshold the
    // scan walks ONLY rows that should have a non-null cost, so the
    // ones we already wrote stamp out of the universe and the residual
    // shrinks monotonically to zero.
    //
    // No callType pre-filter: AI-handled inbound rows are chargeable too
    // (Retell bills agent time regardless of direction), so we must scan
    // both directions. Non-chargeable rows (IN + HUMAN/UNKNOWN) get
    // computeCallCostFromRate=null → costsEqual(null,null)=true →
    // unchanged → no write, so the extra scan cost is paid only in
    // pagination, not in mutations.
    const baseFilter: Record<string, unknown> = {};
    if (onlyMissing) {
      baseFilter.cost = { amountMicros: { is: 'NULL' } };
      if (rates.minChargeableDurationSeconds > 0) {
        baseFilter.duration = { gte: rates.minChargeableDurationSeconds };
      }
    }
    const filter =
      fromIso || toIso
        ? {
            ...baseFilter,
            and: [
              ...(fromIso ? [{ callStart: { gte: fromIso } }] : []),
              ...(toIso ? [{ callStart: { lte: toIso } }] : []),
            ],
          }
        : baseFilter;

    const res = (await client.query({
      callLogs: {
        __args: {
          filter,
          orderBy: [{ callStart: 'DescNullsLast' }],
          first: PAGE_SIZE,
          ...(after ? { after } : {}),
        },
        edges: {
          node: {
            id: true,
            callType: true,
            callerType: true,
            duration: true,
            cost: { amountMicros: true, currencyCode: true },
          },
        },
        pageInfo: { hasNextPage: true, endCursor: true },
      },
    })) as {
      callLogs?: {
        edges?: Array<{ node: CallLogRow }>;
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
      };
    };
    const edges = res.callLogs?.edges ?? [];
    scanned += edges.length;

    for (const { node } of edges) {
      if (candidates.length >= limit) break;
      const computed = computeCallCostFromRate(
        {
          callType: node.callType,
          callerType: node.callerType,
          duration: node.duration,
        },
        rates,
      );
      if (costsEqual(node.cost ?? null, computed)) continue;
      candidates.push(node);
    }

    hasNextPageInScan = res.callLogs?.pageInfo?.hasNextPage === true;
    after = res.callLogs?.pageInfo?.endCursor;
    if (!after) hasNextPageInScan = false;
  }

  let updated = 0;
  let cleared = 0;
  let unchanged = 0;
  let failed = 0;

  for (let i = 0; i < candidates.length; i += MUTATION_BATCH) {
    const wave = candidates.slice(i, i + MUTATION_BATCH);
    const results = await Promise.allSettled(
      wave.map((row) => {
        const computed = computeCallCostFromRate(
          {
            callType: row.callType,
            callerType: row.callerType,
            duration: row.duration,
          },
          rates,
        );
        const data: Record<string, unknown> = {
          // CURRENCY field set to null clears it. Twenty serialises null in
          // mutations, so we always assign even when computed is null.
          cost: computed,
        };
        return client
          .mutation({
            updateCallLog: { __args: { id: row.id, data }, id: true },
          })
          .then(() => ({ wasCleared: computed === null }));
      }),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        if ((r.value as { wasCleared: boolean }).wasCleared) cleared++;
        else updated++;
      } else {
        failed++;
        console.warn(
          `[recompute-costs] update failed: ${String(r.reason).slice(0, 300)}`,
        );
      }
    }
  }

  // Whatever was scanned but already matched the computed value counts as
  // unchanged. Useful for reporting "Nothing to update" cleanly.
  unchanged = scanned - candidates.length;

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[recompute-costs] DONE onlyMissing=${onlyMissing} from=${fromIso ?? '-'} to=${toIso ?? '-'} ratesConfigured=${ratesConfigured} scanned=${scanned} picked=${candidates.length} updated=${updated} cleared=${cleared} unchanged=${unchanged} failed=${failed} hasMore=${hasNextPageInScan} elapsed=${elapsedMs}ms`,
  );

  return {
    ok: true,
    scanned,
    picked: candidates.length,
    updated,
    unchanged,
    cleared,
    failed,
    hasMore: hasNextPageInScan,
    elapsedMs,
  };
};

export default defineLogicFunction({
  universalIdentifier: RECOMPUTE_COSTS_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'recompute-costs',
  description:
    'Recomputes callLog.cost using ZADARMA_RATE_PER_MINUTE / AI_RATE_PER_MINUTE × duration. Chargeable rows = outbound + AI-handled inbound (Retell bills agent time regardless of direction). Non-AI inbound stays cost=null. Default body `{ onlyMissing: true }` pre-filters cost IS NULL. Optional `{ fromIso, toIso }` bounds callStart so the UI can chunk by month and dodge Twenty\'s deep-pagination cap on workspaces with thousands of legacy rows. Set `onlyMissing: false` to refresh every row (e.g. after a rate change). Calls shorter than MIN_CHARGEABLE_DURATION_SECONDS (default 15) get cost=null.',
  timeoutSeconds: 300,
  handler,
  httpRouteTriggerSettings: {
    path: '/zadarma/recompute-costs',
    httpMethod: 'POST',
    isAuthRequired: true,
    forwardedRequestHeaders: ['authorization'],
  },
});
