import { describe, expect, it, vi } from 'vitest';

import {
  resolveCallLogMatch,
  type MatchInput,
  type MatchOutput,
} from './resolve-call-log-match';

type CandidateRow = {
  id: string;
  callStart?: string | null;
  duration?: number | null;
  correlationId?: string | null;
  internalExtension?: string | null;
};

// Minimal CoreApiClient stub: just `query`. Tests build per-case responses.
const buildClientStub = (
  byCorrelationId: Map<string, CandidateRow[]>,
  fuzzyCandidates: CandidateRow[],
) => {
  const query = vi.fn(async (q: Record<string, unknown>) => {
    const callLogs = q.callLogs as { __args?: { filter?: Record<string, { eq?: string; is?: string; in?: string[] }> } };
    const filter = callLogs.__args?.filter ?? {};
    if ('correlationId' in filter && filter.correlationId.eq !== undefined) {
      const rows = byCorrelationId.get(filter.correlationId.eq) ?? [];
      return {
        callLogs: { edges: rows.map((r) => ({ node: r })) },
      };
    }
    // Fuzzy path — apply internalExtension.in filter if present.
    let rows = fuzzyCandidates;
    if ('internalExtension' in filter && Array.isArray(filter.internalExtension.in)) {
      const allowed = new Set(filter.internalExtension.in);
      rows = rows.filter((r) => r.internalExtension && allowed.has(r.internalExtension));
    }
    return { callLogs: { edges: rows.map((r) => ({ node: r })) } };
  });
  return { query };
};

const baseInput: Omit<MatchInput, 'correlationId' | 'startTimestamp' | 'endTimestamp'> = {
  fromNumber: '+48573580808',
  toNumber: '+48539923725',
  windowSeconds: 60,
  requireExtensions: false,
  aiExtensions: [],
};

describe('resolveCallLogMatch', () => {
  it('strategy 1: matches by correlationId (idempotent)', async () => {
    const client = buildClientStub(
      new Map([['call_xyz', [{ id: 'cl-1', callStart: '2026-05-04T11:11:14.000Z', correlationId: 'call_xyz' }]]]),
      [],
    );
    const out = await resolveCallLogMatch(
      client as never,
      { ...baseInput, correlationId: 'call_xyz', startTimestamp: 0 },
    );
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.callLogId).toBe('cl-1');
      expect(out.matchedBy).toBe('correlationId');
    }
  });

  it('strategy 2: time-window-start when correlationId not yet stored', async () => {
    const startMs = Date.UTC(2026, 4, 4, 11, 11, 0);
    const client = buildClientStub(
      new Map(),
      [{ id: 'cl-2', callStart: '2026-05-04T11:11:02.000Z', correlationId: null, internalExtension: '103' }],
    );
    const out = await resolveCallLogMatch(client as never, {
      ...baseInput,
      correlationId: 'call_new',
      startTimestamp: startMs,
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.callLogId).toBe('cl-2');
      expect(out.matchedBy).toBe('time-window-start');
      // ~2 sec offset (UTC reference vs callStart)
      expect(out.offsetMs).toBeLessThan(60_000);
    }
  });

  it('strategy 2: rejects candidates outside ± window', async () => {
    const startMs = Date.UTC(2026, 4, 4, 12, 0, 0);
    const client = buildClientStub(
      new Map(),
      [{ id: 'cl-3', callStart: '2026-05-04T11:00:00.000Z', correlationId: null }],
    );
    const out = await resolveCallLogMatch(client as never, {
      ...baseInput,
      startTimestamp: startMs,
      windowSeconds: 60,
    });
    expect(out.matched).toBe(false);
  });

  it('strategy 2: picks closest when multiple candidates in window', async () => {
    const startMs = Date.UTC(2026, 4, 4, 11, 11, 14);
    const client = buildClientStub(
      new Map(),
      [
        { id: 'cl-far', callStart: '2026-05-04T11:10:30.000Z', correlationId: null }, // -44s
        { id: 'cl-near', callStart: '2026-05-04T11:11:02.000Z', correlationId: null }, // -12s
        { id: 'cl-other', callStart: '2026-05-04T11:11:50.000Z', correlationId: null }, // +36s
      ],
    );
    const out = await resolveCallLogMatch(client as never, {
      ...baseInput,
      startTimestamp: startMs,
      windowSeconds: 60,
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.callLogId).toBe('cl-near');
    }
  });

  it('strategy 3: matches by end_timestamp using callStart + duration', async () => {
    // call started 2026-05-04T11:11:00, duration 174s → end ~2026-05-04T11:13:54
    const endMs = Date.parse('2026-05-04T11:13:55.373Z');
    const client = buildClientStub(
      new Map(),
      [{ id: 'cl-4', callStart: '2026-05-04T11:11:00.000Z', duration: 174, correlationId: null }],
    );
    const out = await resolveCallLogMatch(client as never, {
      ...baseInput,
      endTimestamp: endMs,
      windowSeconds: 60,
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.matchedBy).toBe('time-window-end');
    }
  });

  it('strategy 4: recent fallback when no timestamps provided', async () => {
    const recentIso = new Date(Date.now() - 30 * 1000).toISOString();
    const client = buildClientStub(
      new Map(),
      [{ id: 'cl-recent', callStart: recentIso, correlationId: null }],
    );
    const out = await resolveCallLogMatch(client as never, {
      ...baseInput,
      windowSeconds: 60,
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.matchedBy).toBe('recent-fallback');
    }
  });

  it('AI_EXTENSIONS filter narrows candidates', async () => {
    const startMs = Date.UTC(2026, 4, 4, 11, 11, 14);
    const client = buildClientStub(
      new Map(),
      [
        { id: 'cl-human', callStart: '2026-05-04T11:11:02.000Z', correlationId: null, internalExtension: '101' },
        { id: 'cl-ai', callStart: '2026-05-04T11:11:05.000Z', correlationId: null, internalExtension: '103' },
      ],
    );
    const out = await resolveCallLogMatch(client as never, {
      ...baseInput,
      startTimestamp: startMs,
      requireExtensions: true,
      aiExtensions: ['103', '105'],
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.callLogId).toBe('cl-ai');
    }
  });

  it('returns matched:false when no candidates fit', async () => {
    const client = buildClientStub(new Map(), []);
    const out = await resolveCallLogMatch(client as never, {
      ...baseInput,
      startTimestamp: Date.UTC(2026, 4, 4, 11, 11, 14),
    });
    expect(out.matched).toBe(false);
    if (!out.matched) {
      expect(out.reason).toContain('no callLog matched');
    }
  });

  it('returns matched:false when toNumber missing for fuzzy', async () => {
    const client = buildClientStub(new Map(), []);
    const out = await resolveCallLogMatch(client as never, {
      ...baseInput,
      toNumber: undefined,
      startTimestamp: Date.UTC(2026, 4, 4, 11, 11, 14),
    });
    expect(out.matched).toBe(false);
    if (!out.matched) {
      expect(out.reason).toContain('toNumber is required');
    }
  });

  it('falls through to fuzzy when correlationId provided but not yet stored', async () => {
    const startMs = Date.UTC(2026, 4, 4, 11, 11, 14);
    const client = buildClientStub(
      new Map(), // no correlationId hit
      [{ id: 'cl-new', callStart: '2026-05-04T11:11:02.000Z', correlationId: null }],
    );
    const out: MatchOutput = await resolveCallLogMatch(client as never, {
      ...baseInput,
      correlationId: 'call_new_1',
      startTimestamp: startMs,
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.matchedBy).toBe('time-window-start');
    }
  });
});
