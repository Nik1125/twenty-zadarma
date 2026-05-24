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
  callId?: string | null;
  disposition?: string | null;
  recording?: { primaryLinkUrl?: string | null } | null;
};

type FuzzyRow = CandidateRow & { clientNumber?: string };

// Minimal CoreApiClient stub: just `query`. Tests build per-case responses.
const buildClientStub = (
  byCorrelationId: Map<string, CandidateRow[]>,
  fuzzyCandidates: FuzzyRow[],
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
    // Fuzzy path — emulate `clientNumber: { in: [...] }` on the test fixture.
    // Rows without a `clientNumber` field are treated as wildcard matches so
    // existing tests (which don't populate it) keep passing.
    let rows = fuzzyCandidates;
    if (
      'clientNumber' in filter &&
      Array.isArray(filter.clientNumber.in) &&
      filter.clientNumber.in.length > 0
    ) {
      const allowed = new Set(filter.clientNumber.in);
      rows = rows.filter(
        (r) => r.clientNumber === undefined || allowed.has(r.clientNumber),
      );
    }
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

  it('returns matched:false when both toNumber and fromNumber missing for fuzzy', async () => {
    const client = buildClientStub(new Map(), []);
    const out = await resolveCallLogMatch(client as never, {
      ...baseInput,
      toNumber: undefined,
      fromNumber: undefined,
      startTimestamp: Date.UTC(2026, 4, 4, 11, 11, 14),
    });
    expect(out.matched).toBe(false);
    if (!out.matched) {
      expect(out.reason).toContain('required for fuzzy match');
    }
  });

  it('strategy 2: matches inbound by fromNumber (Retell sends our DID as toNumber)', async () => {
    // For a Retell-handled inbound:
    //   match.toNumber   = our DID (+48573580808)        ← does NOT equal callLog.clientNumber
    //   match.fromNumber = client phone (+48539923725)   ← matches callLog.clientNumber
    // The OR-match on clientNumber lets us land on the right row.
    const startMs = Date.UTC(2026, 4, 4, 11, 11, 0);
    const client = buildClientStub(
      new Map(),
      [
        {
          id: 'cl-inbound',
          callStart: '2026-05-04T11:11:02.000Z',
          correlationId: null,
          clientNumber: '48539923725',
        },
      ],
    );
    const out = await resolveCallLogMatch(client as never, {
      ...baseInput,
      toNumber: '+48573580808',     // our DID — Retell's `to_number`
      fromNumber: '+48539923725',   // client phone — Retell's `from_number`
      startTimestamp: startMs,
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.callLogId).toBe('cl-inbound');
      expect(out.matchedBy).toBe('time-window-start');
    }
  });

  it('strategy 2: filters out rows whose clientNumber is neither party', async () => {
    const startMs = Date.UTC(2026, 4, 4, 11, 11, 0);
    const client = buildClientStub(
      new Map(),
      [
        // Decoy: clientNumber doesn't match either to/from — must NOT pick.
        {
          id: 'cl-other',
          callStart: '2026-05-04T11:11:02.000Z',
          correlationId: null,
          clientNumber: '48999999999',
        },
        // Real candidate matching fromNumber.
        {
          id: 'cl-real',
          callStart: '2026-05-04T11:11:05.000Z',
          correlationId: null,
          clientNumber: '48539923725',
        },
      ],
    );
    const out = await resolveCallLogMatch(client as never, {
      ...baseInput,
      toNumber: '+48573580808',
      fromNumber: '+48539923725',
      startTimestamp: startMs,
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.callLogId).toBe('cl-real');
    }
  });

  // --- Retell two-leg duplicate collapse ---------------------------------
  // One physical outbound call originated via Retell shows up as TWO Zadarma
  // PBX legs with distinct pbx_call_id. The "real" PSTN leg carries an
  // Asterisk callId (+ ANSWERED + duration); the "phantom" SIP-origination
  // leg has an empty callId (often CALL_FAILED / duration 0). Enrichment must
  // converge on the real leg and return the phantom(s) in `collapseIds` so the
  // caller can soft-delete them.
  it('collapse: canonical = leg with callId, phantom returned in collapseIds', async () => {
    const startMs = Date.UTC(2026, 4, 22, 16, 40, 7);
    const client = buildClientStub(new Map(), [
      {
        id: 'phantom',
        callStart: '2026-05-22T16:40:08.000Z',
        correlationId: null,
        clientNumber: '48530500511',
        callId: '',
        disposition: 'CALL_FAILED',
        duration: 0,
      },
      {
        id: 'real',
        callStart: '2026-05-22T16:40:07.000Z',
        correlationId: null,
        clientNumber: '48530500511',
        callId: '1779468006.16770855',
        disposition: 'ANSWERED',
        duration: 31,
      },
    ]);
    const out = await resolveCallLogMatch(client as never, {
      ...baseInput,
      toNumber: '+48530500511',
      correlationId: 'call_f88c',
      startTimestamp: startMs,
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.callLogId).toBe('real');
      expect(out.collapseIds).toEqual(['phantom']);
    }
  });

  it('collapse: single leg yields empty collapseIds (no duplicate)', async () => {
    const startMs = Date.UTC(2026, 4, 4, 11, 11, 0);
    const client = buildClientStub(new Map(), [
      {
        id: 'solo',
        callStart: '2026-05-04T11:11:02.000Z',
        correlationId: null,
        clientNumber: '48539923725',
        callId: 'x.1',
        disposition: 'ANSWERED',
        duration: 20,
      },
    ]);
    const out = await resolveCallLogMatch(client as never, {
      ...baseInput,
      startTimestamp: startMs,
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.callLogId).toBe('solo');
      expect(out.collapseIds).toEqual([]);
    }
  });

  it('collapse: two distinct real legs (both have callId) are NOT collapsed', async () => {
    const startMs = Date.UTC(2026, 4, 4, 11, 11, 5);
    const client = buildClientStub(new Map(), [
      {
        id: 'call-a',
        callStart: '2026-05-04T11:11:04.000Z',
        correlationId: null,
        clientNumber: '48539923725',
        callId: 'a.1',
        disposition: 'ANSWERED',
        duration: 10,
      },
      {
        id: 'call-b',
        callStart: '2026-05-04T11:11:06.000Z',
        correlationId: null,
        clientNumber: '48539923725',
        callId: 'b.1',
        disposition: 'ANSWERED',
        duration: 12,
      },
    ]);
    const out = await resolveCallLogMatch(client as never, {
      ...baseInput,
      startTimestamp: startMs,
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      // neither leg is a phantom (both carry callId) → keep both
      expect(out.collapseIds).toEqual([]);
    }
  });

  it('collapse: phantom-only cluster (no real leg yet) collapses nothing', async () => {
    const startMs = Date.UTC(2026, 4, 4, 11, 11, 5);
    const client = buildClientStub(new Map(), [
      {
        id: 'phantom-only',
        callStart: '2026-05-04T11:11:05.000Z',
        correlationId: null,
        clientNumber: '48539923725',
        callId: '',
        disposition: 'CALL_FAILED',
        duration: 0,
      },
    ]);
    const out = await resolveCallLogMatch(client as never, {
      ...baseInput,
      startTimestamp: startMs,
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.callLogId).toBe('phantom-only');
      expect(out.collapseIds).toEqual([]);
    }
  });

  it('collapse: correlationId hit returns empty collapseIds + hasRecording from row', async () => {
    const client = buildClientStub(
      new Map([
        [
          'call_x',
          [
            {
              id: 'cl-1',
              callStart: '2026-05-04T11:11:14.000Z',
              correlationId: 'call_x',
              recording: { primaryLinkUrl: 'https://rec.example/file.mp3' },
            },
          ],
        ],
      ]),
      [],
    );
    const out = await resolveCallLogMatch(client as never, {
      ...baseInput,
      correlationId: 'call_x',
      startTimestamp: 0,
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.collapseIds).toEqual([]);
      expect(out.hasRecording).toBe(true);
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
