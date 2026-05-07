import { defineLogicFunction } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';
import { CoreApiClient } from 'twenty-client-sdk/core';

// Why a build-once map instead of per-orphan GraphQL lookups?
// - additionalPhones is RAW_JSON; filtering it via `like` is fragile and
//   doesn't compose with the suffix-match rule we use for primary phones.
// - One pass over Persons is O(persons), one pass over orphans is O(orphans).
//   Building the suffix → personId map up-front gets us O(persons + orphans)
//   total instead of O(orphans × person_lookup_query).
//
// Match rule (mirrors find-person-by-phone): compare last 9 digits of the
// orphan clientNumber against the last 9 digits of every Person phone
// (primary + each entry in additionalPhones). 9 covers Polish mobiles and
// most country mobile lengths; the older 'eq' match falls out for free
// because callLog.clientNumber is already E.164-without-plus.

type AdditionalPhone = { number?: string | null };
type PersonNode = {
  id: string;
  phones?: {
    primaryPhoneNumber?: string | null;
    additionalPhones?: AdditionalPhone[] | null;
  } | null;
};
type OrphanNode = { id: string; clientNumber?: string | null };

const PAGE_SIZE = 200;
// Mutations per Promise.all wave. CoreApiClient is workspace-internal so
// there is no external rate limit, but each mutation still hits Postgres;
// 10 keeps load bounded while cutting wall-time ~10x vs sequential awaits.
const MUTATION_BATCH = 10;
const SUFFIX_LEN = 9;

const phoneKey = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, '');
  if (!digits) return null;
  return digits.length >= SUFFIX_LEN ? digits.slice(-SUFFIX_LEN) : digits;
};

const buildPersonsByPhoneSuffix = async (
  client: CoreApiClient,
): Promise<Map<string, string>> => {
  const map = new Map<string, string>();
  let after: string | null | undefined = undefined;
  let hasMore = true;
  while (hasMore) {
    const res = (await client.query({
      people: {
        __args: { first: PAGE_SIZE, ...(after ? { after } : {}) },
        edges: {
          node: {
            id: true,
            phones: {
              primaryPhoneNumber: true,
              additionalPhones: true,
            },
          },
        },
        pageInfo: { hasNextPage: true, endCursor: true },
      },
    })) as {
      people?: {
        edges?: Array<{ node: PersonNode }>;
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
      };
    };
    const edges = res.people?.edges ?? [];
    for (const { node } of edges) {
      const primary = phoneKey(node.phones?.primaryPhoneNumber);
      if (primary && !map.has(primary)) map.set(primary, node.id);
      const additional = node.phones?.additionalPhones;
      if (Array.isArray(additional)) {
        for (const ap of additional) {
          const key = phoneKey(ap?.number);
          if (key && !map.has(key)) map.set(key, node.id);
        }
      }
    }
    hasMore = res.people?.pageInfo?.hasNextPage === true;
    after = res.people?.pageInfo?.endCursor;
    if (!after) hasMore = false;
  }
  return map;
};

const linkOrphanCollection = async (
  client: CoreApiClient,
  collection: 'callLogs' | 'smsLogs',
  mutationName: 'updateCallLog' | 'updateSmsLog',
  personMap: Map<string, string>,
): Promise<{ scanned: number; linked: number }> => {
  let scanned = 0;
  let linked = 0;
  let after: string | null | undefined = undefined;
  let hasMore = true;
  let pageNum = 0;
  while (hasMore) {
    pageNum++;
    const res = (await client.query({
      [collection]: {
        __args: {
          filter: { personId: { is: 'NULL' } },
          first: PAGE_SIZE,
          ...(after ? { after } : {}),
        },
        edges: { node: { id: true, clientNumber: true } },
        pageInfo: { hasNextPage: true, endCursor: true },
      },
    })) as Record<
      string,
      {
        edges?: Array<{ node: OrphanNode }>;
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
      }
    >;
    const conn = res[collection];
    const edges = conn?.edges ?? [];

    const toLink: Array<{ id: string; personId: string }> = [];
    for (const { node } of edges) {
      scanned++;
      const key = phoneKey(node.clientNumber);
      const personId = key ? personMap.get(key) : undefined;
      if (personId) toLink.push({ id: node.id, personId });
    }

    for (let i = 0; i < toLink.length; i += MUTATION_BATCH) {
      const batch = toLink.slice(i, i + MUTATION_BATCH);
      await Promise.all(
        batch.map(({ id, personId }) =>
          client.mutation({
            [mutationName]: {
              __args: { id, data: { personId } },
              id: true,
            },
          }),
        ),
      );
      linked += batch.length;
    }

    console.log(
      `[rescan-orphans] ${collection} page=${pageNum} scanned=${scanned} linked=${linked}`,
    );

    hasMore = conn?.pageInfo?.hasNextPage === true;
    after = conn?.pageInfo?.endCursor;
    if (!after) hasMore = false;
  }
  return { scanned, linked };
};

const handler = async (_event: RoutePayload<unknown>) => {
  const client = new CoreApiClient();
  const startedAt = Date.now();

  const personMap = await buildPersonsByPhoneSuffix(client);

  const calls = await linkOrphanCollection(
    client,
    'callLogs',
    'updateCallLog',
    personMap,
  );
  const sms = await linkOrphanCollection(
    client,
    'smsLogs',
    'updateSmsLog',
    personMap,
  );

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[rescan-orphans] persons=${personMap.size} scannedCalls=${calls.scanned} linkedCalls=${calls.linked} scannedSms=${sms.scanned} linkedSms=${sms.linked} elapsedMs=${elapsedMs}`,
  );

  return {
    ok: true,
    scannedCalls: calls.scanned,
    linkedCalls: calls.linked,
    scannedSms: sms.scanned,
    linkedSms: sms.linked,
    elapsedMs,
  };
};

export default defineLogicFunction({
  universalIdentifier: '14e67390-c549-4fcf-b318-88b222f9a817',
  name: 'rescan-orphans',
  description:
    'Re-scans every callLog and smsLog with no Person link, matching them against every Person phone (primary + additionalPhones). Idempotent — safe to run repeatedly.',
  timeoutSeconds: 300,
  handler,
  httpRouteTriggerSettings: {
    path: '/zadarma/orphans/rescan',
    httpMethod: 'POST',
    isAuthRequired: true,
    forwardedRequestHeaders: ['authorization'],
  },
});
