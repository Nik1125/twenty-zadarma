import { CoreApiClient } from 'twenty-client-sdk/core';

// Shared "missed calls" computation for the Zadarma Inbox → Calls tab
// (GET /zadarma/inbox/missed-calls). Structural mirror of
// compute-unanswered-threads (the SMS channel).
//
// A Person is "missed" while there are missed inbound calls newer than
// max(their last outbound call, their last real-answered inbound call,
// their zadarmaCallsClearedAt).
//
//  - missed inbound = callType IN AND (disposition != ANSWERED OR
//    duration < minDurationSeconds). The duration gate filters PBX "ghost"
//    answers (ANSWERED but a few seconds, no real conversation).
//  - any OUT call resolves (operator called back — task done, regardless of
//    whether the client picked up).
//  - a real-answered IN call resolves (they re-called, we picked up for real).
//
// All timestamps are compared as epoch ms (Date.parse), never as ISO strings —
// mixed precision (clearedAt millis vs migrated second-precision) sorts wrong
// lexically because 'Z' > '.'. See [[project-sms-inbox-standalone-page]].

export type MissedCallThread = {
  personId: string;
  name: string;
  clientNumber: string | null;
  lastBody: string;
  lastAt: string;
  unreadCount: number;
};

type CallNode = {
  personId?: string | null;
  callType?: 'IN' | 'OUT' | null;
  disposition?: string | null;
  duration?: number | null;
  callStart?: string | null;
  clientNumber?: string | null;
};

type PersonAgg = {
  lastOutMs: number;
  lastAnsweredInMs: number;
  missed: Array<{ ms: number; iso: string; clientNumber: string | null }>;
};

const PAGE_SIZE = 200;

const fullName = (
  name: { firstName?: string | null; lastName?: string | null } | null,
): string => {
  const f = (name?.firstName ?? '').trim();
  const l = (name?.lastName ?? '').trim();
  return [f, l].filter(Boolean).join(' ');
};

export const computeMissedCalls = async (
  client: CoreApiClient,
  windowDays: number,
  minDurationSeconds: number,
): Promise<{ threads: MissedCallThread[]; scanned: number }> => {
  const windowStart = new Date(
    Date.now() - windowDays * 86_400_000,
  ).toISOString();

  // 1) Window scan — classify each call per Person.
  const byPerson = new Map<string, PersonAgg>();
  let scanned = 0;
  let after: string | null | undefined = undefined;
  let hasMore = true;
  while (hasMore) {
    const res = (await client.query({
      callLogs: {
        __args: {
          filter: { callStart: { gte: windowStart } },
          first: PAGE_SIZE,
          ...(after ? { after } : {}),
        },
        edges: {
          node: {
            personId: true,
            callType: true,
            disposition: true,
            duration: true,
            callStart: true,
            clientNumber: true,
          },
        },
        pageInfo: { hasNextPage: true, endCursor: true },
      },
    })) as {
      callLogs?: {
        edges?: Array<{ node: CallNode }>;
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
      };
    };
    const conn = res.callLogs;
    for (const { node } of conn?.edges ?? []) {
      scanned++;
      const personId = node.personId;
      const callStart = node.callStart;
      if (!personId || !callStart) continue;
      const ms = Date.parse(callStart);
      if (Number.isNaN(ms)) continue;
      let agg = byPerson.get(personId);
      if (!agg) {
        agg = { lastOutMs: 0, lastAnsweredInMs: 0, missed: [] };
        byPerson.set(personId, agg);
      }
      if (node.callType === 'OUT') {
        // Any outbound call = operator acted → resolves, any disposition.
        if (ms > agg.lastOutMs) agg.lastOutMs = ms;
      } else if (node.callType === 'IN') {
        const realAnswered =
          node.disposition === 'ANSWERED' &&
          (node.duration ?? 0) >= minDurationSeconds;
        if (realAnswered) {
          if (ms > agg.lastAnsweredInMs) agg.lastAnsweredInMs = ms;
        } else {
          agg.missed.push({
            ms,
            iso: callStart,
            clientNumber: node.clientNumber ?? null,
          });
        }
      }
    }
    hasMore = conn?.pageInfo?.hasNextPage === true;
    after = conn?.pageInfo?.endCursor;
    if (!after) hasMore = false;
  }

  // 2) Candidates = Persons with at least one missed inbound call in window.
  const candidateIds = [...byPerson.entries()]
    .filter(([, a]) => a.missed.length > 0)
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
            zadarmaCallsClearedAt: true,
          },
        },
      },
    })) as {
      people?: {
        edges?: Array<{
          node: {
            id: string;
            name: { firstName?: string | null; lastName?: string | null } | null;
            zadarmaCallsClearedAt: string | null;
          };
        }>;
      };
    };
    for (const { node } of res.people?.edges ?? []) {
      const clearedMs = node.zadarmaCallsClearedAt
        ? Date.parse(node.zadarmaCallsClearedAt)
        : 0;
      personInfo.set(node.id, {
        name: fullName(node.name),
        clearedMs: Number.isNaN(clearedMs) ? 0 : clearedMs,
      });
    }
  }

  // 4) Per candidate: missed = missed-in calls after max(lastOut, lastAnswered, cleared).
  const threads = candidateIds
    .map((personId) => {
      const agg = byPerson.get(personId);
      if (!agg) return null;
      const info = personInfo.get(personId);
      const cutoff = Math.max(
        agg.lastOutMs,
        agg.lastAnsweredInMs,
        info?.clearedMs ?? 0,
      );
      const unresolved = agg.missed.filter((m) => m.ms > cutoff);
      if (unresolved.length === 0) return null;
      const latest = unresolved.reduce((a, b) => (b.ms > a.ms ? b : a));
      const display =
        info?.name || (latest.clientNumber ? '+' + latest.clientNumber : 'Unknown');
      return {
        personId,
        name: display,
        clientNumber: latest.clientNumber,
        // Empty server-side — the frontend renders "Missed call" (×N).
        lastBody: '',
        lastAt: latest.iso,
        lastMs: latest.ms,
        unreadCount: unresolved.length,
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null)
    .sort((a, b) => b.lastMs - a.lastMs)
    .map(({ lastMs: _lastMs, ...rest }) => rest);

  return { threads, scanned };
};
