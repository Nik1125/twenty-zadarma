import { defineLogicFunction } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';
import { CoreApiClient } from 'twenty-client-sdk/core';

// GET /s/zadarma/inbox — messenger-style "unanswered SMS" feed for the global
// Zadarma Inbox standalone page.
//
// Model (derived, see [[project-sms-inbox-standalone-page]]):
//   A Person is "unanswered" while there are inbound SMS newer than
//   max(their last outbound SMS, their zadarmaSmsClearedAt). Replying advances
//   the last outbound and auto-clears; the manual "mark read" button stamps
//   zadarmaSmsClearedAt=now (handled by inbox-clear). The unread COUNT is never
//   stored — it's recomputed here every call from the logs.
//
// All timestamp comparisons go through Date.parse → epoch ms. Comparing the
// raw ISO strings lexicographically is WRONG when precision differs (clearedAt
// is written with milliseconds via Date.toISOString(); migrated/imported SMS
// may carry only second precision) — a same-second mixed-precision pair sorts
// incorrectly because 'Z' > '.'. Epoch numbers are immune.
//
// Scan strategy: single window pass over smsLogs in the last N days (default
// 90), grouped per Person in memory. Any reply lives in the same window as the
// inbound it answers (an OUT after an IN is newer than that IN), so the window
// captures the answered/unanswered decision correctly. Truly ancient (>window)
// never-answered inbound is intentionally out of scope for v1. If a busy
// workspace pushes the scan past Twenty's cursor-pagination cap (~200–2400
// rows), the fix is date-chunking the window — not needed yet.

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
const DEFAULT_WINDOW_DAYS = 90;
const SNIPPET_MAX = 140;

const clampDays = (raw: string | undefined): number => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_WINDOW_DAYS;
  return Math.min(Math.max(Math.floor(n), 1), 365);
};

const fullName = (
  name: { firstName?: string | null; lastName?: string | null } | null,
): string => {
  const f = (name?.firstName ?? '').trim();
  const l = (name?.lastName ?? '').trim();
  return [f, l].filter(Boolean).join(' ');
};

const handler = async (event: RoutePayload<unknown>) => {
  const client = new CoreApiClient();
  const startedAt = Date.now();

  const days = clampDays(event.queryStringParameters?.days);
  const windowStart = new Date(Date.now() - days * 86_400_000).toISOString();

  // 1) Window scan — group SMS per Person.
  const byPerson = new Map<string, PersonAgg>();
  let scanned = 0;
  let after: string | null | undefined = undefined;
  let hasMore = true;
  let page = 0;
  while (hasMore) {
    page++;
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
    // Newest activity on top (messenger convention).
    .sort((a, b) => b.lastMs - a.lastMs)
    .map(({ lastMs: _lastMs, ...rest }) => rest);

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[inbox] days=${days} scanned=${scanned} pages=${page} candidates=${candidateIds.length} threads=${threads.length} elapsedMs=${elapsedMs}`,
  );

  return { ok: true, threads, scanned, windowDays: days, elapsedMs };
};

export default defineLogicFunction({
  universalIdentifier: '34283216-0978-478b-aaf6-e2ff95fc6cae',
  name: 'inbox',
  description:
    'Returns the "unanswered SMS" feed for the Zadarma Inbox: Persons whose inbound SMS are newer than their last outbound and their dismiss marker, sorted newest-first. Unread count derived from the logs.',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    path: '/zadarma/inbox',
    httpMethod: 'GET',
    isAuthRequired: true,
    forwardedRequestHeaders: ['authorization'],
  },
});
