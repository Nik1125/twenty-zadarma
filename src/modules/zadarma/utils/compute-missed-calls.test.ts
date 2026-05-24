import { describe, expect, it, vi } from 'vitest';

import { computeMissedCalls } from './compute-missed-calls';

// Window is generous so every relative timestamp below stays inside it.
const WINDOW_DAYS = 365;
const MIN_DUR = 10;

const ago = (minutes: number): string =>
  new Date(Date.now() - minutes * 60_000).toISOString();

type CallNode = {
  personId: string | null;
  callType: 'IN' | 'OUT' | null;
  disposition?: string | null;
  duration?: number | null;
  callStart: string | null;
  clientNumber?: string | null;
};

type PeopleNode = {
  id: string;
  name: { firstName?: string | null; lastName?: string | null } | null;
  zadarmaCallsClearedAt: string | null;
};

// Mock CoreApiClient: first query (callLogs) returns one page of nodes; the
// second query (people) returns the requested candidates' name + clearedAt.
const makeClient = (calls: CallNode[], people: PeopleNode[]) => {
  const query = vi.fn().mockImplementation((arg: Record<string, unknown>) => {
    if ('callLogs' in arg) {
      return Promise.resolve({
        callLogs: {
          edges: calls.map((node) => ({ node })),
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      });
    }
    if ('people' in arg) {
      const ids: string[] = (arg.people as { __args: { filter: { id: { in: string[] } } } })
        .__args.filter.id.in;
      return Promise.resolve({
        people: {
          edges: people
            .filter((p) => ids.includes(p.id))
            .map((node) => ({ node })),
        },
      });
    }
    return Promise.resolve({});
  });
  return { query } as never;
};

const named = (id: string, first = 'Test', last = 'Person', cleared: string | null = null): PeopleNode => ({
  id,
  name: { firstName: first, lastName: last },
  zadarmaCallsClearedAt: cleared,
});

describe('computeMissedCalls', () => {
  it('surfaces a single missed inbound call (unreadCount 1)', async () => {
    const client = makeClient(
      [{ personId: 'p1', callType: 'IN', disposition: 'NO_ANSWER', duration: 0, callStart: ago(30), clientNumber: '48111' }],
      [named('p1', 'Anna', 'Kowalska')],
    );
    const { threads } = await computeMissedCalls(client, WINDOW_DAYS, MIN_DUR);
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ personId: 'p1', name: 'Anna Kowalska', unreadCount: 1 });
  });

  it('counts multiple missed calls for the same Person', async () => {
    const t30 = ago(30);
    const t20 = ago(20);
    const client = makeClient(
      [
        { personId: 'p1', callType: 'IN', disposition: 'NO_ANSWER', duration: 0, callStart: t30, clientNumber: '48111' },
        { personId: 'p1', callType: 'IN', disposition: 'BUSY', duration: 0, callStart: t20, clientNumber: '48111' },
      ],
      [named('p1')],
    );
    const { threads } = await computeMissedCalls(client, WINDOW_DAYS, MIN_DUR);
    expect(threads).toHaveLength(1);
    expect(threads[0].unreadCount).toBe(2);
    expect(threads[0].lastAt).toBe(t20); // newest missed
  });

  it('any OUT call after the missed call resolves it (even unanswered callback)', async () => {
    const client = makeClient(
      [
        { personId: 'p1', callType: 'IN', disposition: 'NO_ANSWER', duration: 0, callStart: ago(30) },
        { personId: 'p1', callType: 'OUT', disposition: 'NO_ANSWER', duration: 0, callStart: ago(10) },
      ],
      [named('p1')],
    );
    const { threads } = await computeMissedCalls(client, WINDOW_DAYS, MIN_DUR);
    expect(threads).toHaveLength(0);
  });

  it('a later real-answered inbound call resolves the thread', async () => {
    const client = makeClient(
      [
        { personId: 'p1', callType: 'IN', disposition: 'NO_ANSWER', duration: 0, callStart: ago(30) },
        { personId: 'p1', callType: 'IN', disposition: 'ANSWERED', duration: 60, callStart: ago(10) },
      ],
      [named('p1')],
    );
    const { threads } = await computeMissedCalls(client, WINDOW_DAYS, MIN_DUR);
    expect(threads).toHaveLength(0);
  });

  it('ANSWERED but shorter than threshold is still a missed (ghost) call', async () => {
    const client = makeClient(
      [{ personId: 'p1', callType: 'IN', disposition: 'ANSWERED', duration: 5, callStart: ago(30) }],
      [named('p1')],
    );
    const { threads } = await computeMissedCalls(client, WINDOW_DAYS, MIN_DUR);
    expect(threads).toHaveLength(1);
    expect(threads[0].unreadCount).toBe(1);
  });

  it('zadarmaCallsClearedAt dismisses earlier missed calls but not later ones', async () => {
    // cleared at t20: the t30 missed is dismissed, the t10 is not.
    const t30 = ago(30);
    const t20 = ago(20);
    const t10 = ago(10);
    const client = makeClient(
      [
        { personId: 'p1', callType: 'IN', disposition: 'NO_ANSWER', duration: 0, callStart: t30 },
        { personId: 'p1', callType: 'IN', disposition: 'NO_ANSWER', duration: 0, callStart: t10 },
      ],
      [named('p1', 'Test', 'Person', t20)],
    );
    const { threads } = await computeMissedCalls(client, WINDOW_DAYS, MIN_DUR);
    expect(threads).toHaveLength(1);
    expect(threads[0].unreadCount).toBe(1);
    expect(threads[0].lastAt).toBe(t10);
  });

  it('an OUT call BEFORE the missed call does NOT resolve it', async () => {
    const client = makeClient(
      [
        { personId: 'p1', callType: 'OUT', disposition: 'ANSWERED', duration: 60, callStart: ago(40) },
        { personId: 'p1', callType: 'IN', disposition: 'NO_ANSWER', duration: 0, callStart: ago(20) },
      ],
      [named('p1')],
    );
    const { threads } = await computeMissedCalls(client, WINDOW_DAYS, MIN_DUR);
    expect(threads).toHaveLength(1);
    expect(threads[0].unreadCount).toBe(1);
  });

  it('sorts threads newest-first and excludes answered-only Persons', async () => {
    const client = makeClient(
      [
        { personId: 'p1', callType: 'IN', disposition: 'NO_ANSWER', duration: 0, callStart: ago(30) },
        { personId: 'p2', callType: 'IN', disposition: 'NO_ANSWER', duration: 0, callStart: ago(10) },
        { personId: 'p3', callType: 'IN', disposition: 'ANSWERED', duration: 60, callStart: ago(5) },
      ],
      [named('p1', 'One', 'P'), named('p2', 'Two', 'P'), named('p3', 'Three', 'P')],
    );
    const { threads } = await computeMissedCalls(client, WINDOW_DAYS, MIN_DUR);
    expect(threads.map((t) => t.personId)).toEqual(['p2', 'p1']);
  });

  it('falls back to +clientNumber when the Person has no name', async () => {
    const client = makeClient(
      [{ personId: 'p1', callType: 'IN', disposition: 'NO_ANSWER', duration: 0, callStart: ago(30), clientNumber: '48999' }],
      [{ id: 'p1', name: { firstName: '', lastName: '' }, zadarmaCallsClearedAt: null }],
    );
    const { threads } = await computeMissedCalls(client, WINDOW_DAYS, MIN_DUR);
    expect(threads[0].name).toBe('+48999');
  });
});
