import { defineLogicFunction } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';
import { CoreApiClient } from 'twenty-client-sdk/core';

import { ATTACH_OPPORTUNITIES_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { findLatestOpportunityIdForPerson } from 'src/modules/zadarma/utils/find-latest-opportunity-id';

// Backfills `opportunityId` on existing callLog + smsLog rows where the
// row is already linked to a Person (personId IS NOT NULL) but the
// opportunity link is missing. Picks the Person's most-recently-created
// Opportunity (same rule the live handlers use at insert time, so
// backfilled rows match what new rows would land on).
//
// Strategy: page newest-first through the target collection inside a
// 30-day callStart window when bounds are supplied (mirror of the
// recompute-costs drain pattern — Twenty cursor pagination otherwise
// caps deep scans). Per Person, resolve opportunityId once and cache so
// large batches don't re-query the same Person.
//
// Body (all optional):
//   { limit?: number }              default 250, max 500
//   { fromIso?, toIso? }            callStart bounds; UI chunks by month
//   { target?: 'callLog' | 'smsLog' | 'both' }   default 'both'

const DEFAULT_LIMIT = 250;
const MAX_LIMIT = 500;
const PAGE_SIZE = 200;
const MUTATION_BATCH = 10;

type AttachBody = {
  limit?: number;
  fromIso?: string;
  toIso?: string;
  target?: 'callLog' | 'smsLog' | 'both';
};

type CandidateRow = { id: string; personId: string };

type AttachResult = {
  ok: boolean;
  scanned: number;
  picked: number;
  updated: number;
  skipped: number;
  failed: number;
  hasMore: boolean;
  elapsedMs: number;
};

const ALPHA_SORT = [{ createdAt: 'DescNullsLast' as const }];

const buildDateFilter = (
  fromIso: string | undefined,
  toIso: string | undefined,
): Record<string, unknown> | null => {
  if (!fromIso && !toIso) return null;
  const conds: Array<Record<string, unknown>> = [];
  if (fromIso) conds.push({ callStart: { gte: fromIso } });
  if (toIso) conds.push({ callStart: { lte: toIso } });
  return { and: conds };
};

const drainCollection = async (
  client: CoreApiClient,
  collection: 'callLogs' | 'smsLogs',
  limit: number,
  fromIso: string | undefined,
  toIso: string | undefined,
  opportunityCache: Map<string, string | null>,
): Promise<{
  scanned: number;
  picked: number;
  updated: number;
  skipped: number;
  failed: number;
  hasMore: boolean;
}> => {
  // smsLogs don't have a `callStart` column — the date window applies to
  // callLogs only. UI passes the same bounds for both targets; this
  // helper just drops the filter for smsLogs.
  const dateFilter = collection === 'callLogs' ? buildDateFilter(fromIso, toIso) : null;
  const baseFilter: Record<string, unknown> = {
    personId: { is: 'NOT_NULL' },
    opportunityId: { is: 'NULL' },
  };
  const filter = dateFilter ? { ...baseFilter, ...dateFilter } : baseFilter;

  const candidates: CandidateRow[] = [];
  let scanned = 0;
  let after: string | null | undefined = undefined;
  let hasNextPage = true;

  while (candidates.length < limit && hasNextPage) {
    const res = (await client.query({
      [collection]: {
        __args: {
          filter,
          orderBy: ALPHA_SORT,
          first: PAGE_SIZE,
          ...(after ? { after } : {}),
        },
        edges: { node: { id: true, personId: true } },
        pageInfo: { hasNextPage: true, endCursor: true },
      },
    })) as Record<
      string,
      | {
          edges?: Array<{ node: { id: string; personId?: string | null } }>;
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        }
      | undefined
    >;
    const page = res[collection];
    const edges = page?.edges ?? [];
    scanned += edges.length;
    for (const { node } of edges) {
      if (candidates.length >= limit) break;
      if (!node.personId) continue;
      candidates.push({ id: node.id, personId: node.personId });
    }
    hasNextPage = page?.pageInfo?.hasNextPage === true;
    after = page?.pageInfo?.endCursor ?? null;
    if (!after) hasNextPage = false;
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  const mutationName = collection === 'callLogs' ? 'updateCallLog' : 'updateSmsLog';

  for (let i = 0; i < candidates.length; i += MUTATION_BATCH) {
    const wave = candidates.slice(i, i + MUTATION_BATCH);
    const results = await Promise.allSettled(
      wave.map(async (row) => {
        let opportunityId = opportunityCache.get(row.personId);
        if (opportunityId === undefined) {
          opportunityId = await findLatestOpportunityIdForPerson(client, row.personId);
          opportunityCache.set(row.personId, opportunityId);
        }
        if (!opportunityId) {
          // Person has no opportunities — skip the write, leave row null.
          return { wrote: false } as const;
        }
        await client.mutation({
          [mutationName]: {
            __args: { id: row.id, data: { opportunityId } },
            id: true,
          },
        });
        return { wrote: true } as const;
      }),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        if (r.value.wrote) updated += 1;
        else skipped += 1;
      } else {
        failed += 1;
        console.warn(
          `[attach-opportunities] update failed in ${collection}: ${String(r.reason).slice(0, 300)}`,
        );
      }
    }
  }

  return {
    scanned,
    picked: candidates.length,
    updated,
    skipped,
    failed,
    hasMore: hasNextPage,
  };
};

const handler = async (
  event: RoutePayload<AttachBody>,
): Promise<AttachResult> => {
  const startedAt = Date.now();
  const requestedLimit = event.body?.limit;
  const limit =
    typeof requestedLimit === 'number' && requestedLimit > 0
      ? Math.min(Math.floor(requestedLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;
  const fromIso = typeof event.body?.fromIso === 'string' ? event.body.fromIso : undefined;
  const toIso = typeof event.body?.toIso === 'string' ? event.body.toIso : undefined;
  const target = event.body?.target ?? 'both';

  const client = new CoreApiClient();
  const opportunityCache = new Map<string, string | null>();

  let totalScanned = 0;
  let totalPicked = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let anyHasMore = false;

  if (target === 'callLog' || target === 'both') {
    const r = await drainCollection(
      client,
      'callLogs',
      limit,
      fromIso,
      toIso,
      opportunityCache,
    );
    totalScanned += r.scanned;
    totalPicked += r.picked;
    totalUpdated += r.updated;
    totalSkipped += r.skipped;
    totalFailed += r.failed;
    if (r.hasMore) anyHasMore = true;
  }
  if (target === 'smsLog' || target === 'both') {
    const r = await drainCollection(
      client,
      'smsLogs',
      limit,
      fromIso,
      toIso,
      opportunityCache,
    );
    totalScanned += r.scanned;
    totalPicked += r.picked;
    totalUpdated += r.updated;
    totalSkipped += r.skipped;
    totalFailed += r.failed;
    if (r.hasMore) anyHasMore = true;
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[attach-opportunities] DONE target=${target} from=${fromIso ?? '-'} to=${toIso ?? '-'} scanned=${totalScanned} picked=${totalPicked} updated=${totalUpdated} skipped=${totalSkipped} failed=${totalFailed} hasMore=${anyHasMore} elapsed=${elapsedMs}ms`,
  );

  return {
    ok: true,
    scanned: totalScanned,
    picked: totalPicked,
    updated: totalUpdated,
    skipped: totalSkipped,
    failed: totalFailed,
    hasMore: anyHasMore,
    elapsedMs,
  };
};

export default defineLogicFunction({
  universalIdentifier: ATTACH_OPPORTUNITIES_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'attach-opportunities',
  description:
    'Backfills opportunityId on existing callLog + smsLog rows that have a personId set but no opportunity link. Picks the Person\'s most-recently-created Opportunity. Mirrors the live handlers used at insert time, so backfilled rows match newly-created ones. Body: { limit?, fromIso?, toIso?, target? }. UI chunks by 30-day callStart windows to dodge Twenty\'s deep-pagination cap.',
  timeoutSeconds: 300,
  handler,
  httpRouteTriggerSettings: {
    path: '/zadarma/attach-opportunities',
    httpMethod: 'POST',
    isAuthRequired: true,
    forwardedRequestHeaders: ['authorization'],
  },
});
