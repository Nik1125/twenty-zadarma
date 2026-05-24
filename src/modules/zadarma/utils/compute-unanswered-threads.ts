import { CoreApiClient } from 'twenty-client-sdk/core';

// Shared "unanswered SMS" computation used by both the inbox HTTP endpoint
// (GET /zadarma/inbox) and the event-driven inbox-icon signal. A Person is
// "unanswered" while there are inbound SMS newer than max(their last outbound
// SMS, their zadarmaSmsClearedAt). All timestamps are compared as epoch ms
// (Date.parse), never as ISO strings — mixed precision (clearedAt millis vs
// migrated second-precision) sorts wrong lexically because 'Z' > '.'.
//
// Window scan: a reply (OUT) always lives in the same window as the inbound it
// answers, so a bounded last-N-days pass captures the answered/unanswered
// decision. See [[project-sms-inbox-standalone-page]].

export type InboxThread = {
  personId: string;
  name: string;
  clientNumber: string | null;
  lastBody: string;
  lastAt: string;
  unreadCount: number;
};

type SmsNode = {
  personId?: string | null;
  direction?: 'IN' | 'OUT' | null;
  sentAt?: string | null;
  body?: string | null;
  clientNumber?: string | null;
};

type PersonAgg = {
  lastOutMs: number;
  ins: Array<{ ms: number; iso: string; body: string; clientNumber: string | null }>;
};

const PAGE_SIZE = 200;
const SNIPPET_MAX = 140;

const fullName = (
  name: { firstName?: string | null; lastName?: string | null } | null,
): string => {
  const f = (name?.firstName ?? '').trim();
  const l = (name?.lastName ?? '').trim();
  return [f, l].filter(Boolean).join(' ');
};

export const computeUnansweredThreads = async (
  client: CoreApiClient,
  windowDays: number,
): Promise<{ threads: InboxThread[]; scanned: number }> => {
  const windowStart = new Date(
    Date.now() - windowDays * 86_400_000,
  ).toISOString();

  // 1) Window scan — group SMS per Person.
  const byPerson = new Map<string, PersonAgg>();
  let scanned = 0;
  let after: string | null | undefined = undefined;
  let hasMore = true;
  while (hasMore) {
    const res = (await client.query({
      smsLogs: {
        __args: {
          filter: { sentAt: { gte: windowStart } },
          first: PAGE_SIZE,
          ...(after ? { after } : {}),
        },
        edges: {
          node: {
            personId: true,
            direction: true,
            sentAt: true,
            body: true,
            clientNumber: true,
          },
        },
        pageInfo: { hasNextPage: true, endCursor: true },
      },
    })) as {
      smsLogs?: {
        edges?: Array<{ node: SmsNode }>;
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
      };
    };
    const conn = res.smsLogs;
    for (const { node } of conn?.edges ?? []) {
      scanned++;
      const personId = node.personId;
      const sentAt = node.sentAt;
      if (!personId || !sentAt) continue;
      const ms = Date.parse(sentAt);
      if (Number.isNaN(ms)) continue;
      let agg = byPerson.get(personId);
      if (!agg) {
        agg = { lastOutMs: 0, ins: [] };
        byPerson.set(personId, agg);
      }
      if (node.direction === 'OUT') {
        if (ms > agg.lastOutMs) agg.lastOutMs = ms;
      } else if (node.direction === 'IN') {
        agg.ins.push({
          ms,
          iso: sentAt,
          body: node.body ?? '',
          clientNumber: node.clientNumber ?? null,
        });
      }
    }
    hasMore = conn?.pageInfo?.hasNextPage === true;
    after = conn?.pageInfo?.endCursor;
    if (!after) hasMore = false;
  }

  // 2) Candidates = Persons with at least one inbound SMS in the window.
  const candidateIds = [...byPerson.entries()]
    .filter(([, a]) => a.ins.length > 0)
    .map(([id]) => id);

  // 3) Fetch name + dismiss marker for candidates (chunked id IN filter).
  const personInfo = new Map<string, { name: string; clearedMs: number }>();
  for (let i = 0; i < candidateIds.length; i += PAGE_SIZE) {
    const chunk = candidateIds.slice(i, i + PAGE_SIZE);
    const res = (await client.query({
      people: {
        __args: { filter: { id: { in: chunk } }, first: chunk.length },
        edges: {
          node: {
            id: true,
            name: { firstName: true, lastName: true },
            zadarmaSmsClearedAt: true,
          },
        },
      },
    })) as {
      people?: {
        edges?: Array<{
          node: {
            id: string;
            name: { firstName?: string | null; lastName?: string | null } | null;
            zadarmaSmsClearedAt: string | null;
          };
        }>;
      };
    };
    for (const { node } of res.people?.edges ?? []) {
      const clearedMs = node.zadarmaSmsClearedAt
        ? Date.parse(node.zadarmaSmsClearedAt)
        : 0;
      personInfo.set(node.id, {
        name: fullName(node.name),
        clearedMs: Number.isNaN(clearedMs) ? 0 : clearedMs,
      });
    }
  }

  // 4) Per candidate: unread = inbound after max(lastOut, cleared).
  const threads = candidateIds
    .map((personId) => {
      const agg = byPerson.get(personId);
      if (!agg) return null;
      const info = personInfo.get(personId);
      const cutoff = Math.max(agg.lastOutMs, info?.clearedMs ?? 0);
      const unread = agg.ins.filter((m) => m.ms > cutoff);
      if (unread.length === 0) return null;
      const latest = unread.reduce((a, b) => (b.ms > a.ms ? b : a));
      const display =
        info?.name || (latest.clientNumber ? '+' + latest.clientNumber : 'Unknown');
      return {
        personId,
        name: display,
        clientNumber: latest.clientNumber,
        lastBody: latest.body.slice(0, SNIPPET_MAX),
        lastAt: latest.iso,
        lastMs: latest.ms,
        unreadCount: unread.length,
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null)
    .sort((a, b) => b.lastMs - a.lastMs)
    .map(({ lastMs: _lastMs, ...rest }) => rest);

  return { threads, scanned };
};
