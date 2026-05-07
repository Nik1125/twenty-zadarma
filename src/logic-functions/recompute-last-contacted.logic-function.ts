import { defineLogicFunction } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';
import { CoreApiClient } from 'twenty-client-sdk/core';

// One-shot backfill: walk every OUT callLog and OUT smsLog, build a per-Person
// map of the latest outbound timestamp, then upsert Person.lastContactedAt.
// Idempotent — running it twice produces the same result. Safe to run after a
// historical CSV import or to recover from a missed live trigger.
//
// Same shape as rescan-orphans: paginate with first/after, batch mutations
// in waves of MUTATION_BATCH for parallelism without unbounded fan-out.

type OutCallNode = {
  id: string;
  personId?: string | null;
  callStart?: string | null;
};
type OutSmsNode = {
  id: string;
  personId?: string | null;
  sentAt?: string | null;
};

const PAGE_SIZE = 200;
const MUTATION_BATCH = 10;

const collectMaxByPerson = async <TNode extends { personId?: string | null }>(
  client: CoreApiClient,
  collection: 'callLogs' | 'smsLogs',
  directionField: 'callType' | 'direction',
  timestampField: 'callStart' | 'sentAt',
): Promise<{ map: Map<string, string>; scanned: number }> => {
  const map = new Map<string, string>();
  let scanned = 0;
  let after: string | null | undefined = undefined;
  let hasMore = true;
  let pageNum = 0;
  while (hasMore) {
    pageNum++;
    const res = (await client.query({
      [collection]: {
        __args: {
          filter: { [directionField]: { eq: 'OUT' } },
          first: PAGE_SIZE,
          ...(after ? { after } : {}),
        },
        edges: {
          node: {
            id: true,
            personId: true,
            [timestampField]: true,
          },
        },
        pageInfo: { hasNextPage: true, endCursor: true },
      },
    })) as Record<
      string,
      {
        edges?: Array<{ node: TNode & Record<string, unknown> }>;
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
      }
    >;
    const conn = res[collection];
    const edges = conn?.edges ?? [];
    for (const { node } of edges) {
      scanned++;
      const personId = node.personId;
      if (!personId) continue;
      const ts = node[timestampField] as string | null | undefined;
      if (!ts) continue;
      const current = map.get(personId);
      if (!current || ts > current) map.set(personId, ts);
    }
    console.log(
      `[recompute-last-contacted] ${collection} page=${pageNum} scanned=${scanned} mapped=${map.size}`,
    );
    hasMore = conn?.pageInfo?.hasNextPage === true;
    after = conn?.pageInfo?.endCursor;
    if (!after) hasMore = false;
  }
  return { map, scanned };
};

const handler = async (_event: RoutePayload<unknown>) => {
  const client = new CoreApiClient();
  const startedAt = Date.now();

  const calls = await collectMaxByPerson<OutCallNode>(
    client,
    'callLogs',
    'callType',
    'callStart',
  );
  const sms = await collectMaxByPerson<OutSmsNode>(
    client,
    'smsLogs',
    'direction',
    'sentAt',
  );

  // Merge: take the max of (callStart, sentAt) per Person.
  const merged = new Map<string, string>();
  for (const [personId, ts] of calls.map) merged.set(personId, ts);
  for (const [personId, ts] of sms.map) {
    const existing = merged.get(personId);
    if (!existing || ts > existing) merged.set(personId, ts);
  }

  // Apply: only write when the new value is newer than what's stored. We do
  // this in waves so we both bound load and avoid loading every Person into
  // memory upfront.
  let updated = 0;
  let skippedSameOrNewer = 0;
  const entries = Array.from(merged.entries());
  for (let i = 0; i < entries.length; i += MUTATION_BATCH) {
    const batch = entries.slice(i, i + MUTATION_BATCH);
    const results = await Promise.all(
      batch.map(async ([personId, candidateIso]) => {
        const personRes = (await client.query({
          person: {
            __args: { filter: { id: { eq: personId } } },
            id: true,
            lastContactedAt: true,
          },
        })) as { person?: { lastContactedAt?: string | null } | null };
        const current = personRes.person?.lastContactedAt ?? null;
        if (current && current >= candidateIso) {
          return { updated: false };
        }
        await client.mutation({
          updatePerson: {
            __args: { id: personId, data: { lastContactedAt: candidateIso } },
            id: true,
          },
        });
        return { updated: true };
      }),
    );
    for (const r of results) {
      if (r.updated) updated++;
      else skippedSameOrNewer++;
    }
    console.log(
      `[recompute-last-contacted] applied batch=${i / MUTATION_BATCH + 1} updated=${updated} skipped=${skippedSameOrNewer}`,
    );
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[recompute-last-contacted] persons=${merged.size} scannedCalls=${calls.scanned} scannedSms=${sms.scanned} updated=${updated} skipped=${skippedSameOrNewer} elapsedMs=${elapsedMs}`,
  );

  return {
    ok: true,
    personsConsidered: merged.size,
    scannedCalls: calls.scanned,
    scannedSms: sms.scanned,
    updated,
    skippedSameOrNewer,
    elapsedMs,
  };
};

export default defineLogicFunction({
  universalIdentifier: 'b47db32d-798f-4eb1-9dbb-923172202541',
  name: 'recompute-last-contacted',
  description:
    'Recomputes Person.lastContactedAt across the whole workspace by walking every OUT callLog and OUT smsLog and taking the most recent timestamp per linked Person. Idempotent.',
  timeoutSeconds: 300,
  handler,
  httpRouteTriggerSettings: {
    path: '/zadarma/last-contacted/recompute',
    httpMethod: 'POST',
    isAuthRequired: true,
    forwardedRequestHeaders: ['authorization'],
  },
});
