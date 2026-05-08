import { describe, expect, it } from 'vitest';

import {
  e164NoPlus,
  extractClientFromClid,
  groupAndNormalizeStats,
  type ZadarmaPbxStatRow,
} from './parse-zadarma-pbx-stats';

describe('e164NoPlus', () => {
  it('strips non-digits', () => {
    expect(e164NoPlus('+48 573-580-808')).toBe('48573580808');
    expect(e164NoPlus('  48 573 580 808 ')).toBe('48573580808');
  });

  it('handles numeric input', () => {
    expect(e164NoPlus(48573580808)).toBe('48573580808');
  });

  it('returns empty for nullish', () => {
    expect(e164NoPlus(undefined)).toBe('');
    expect(e164NoPlus(null)).toBe('');
    expect(e164NoPlus('')).toBe('');
  });
});

describe('extractClientFromClid', () => {
  it('extracts from angle brackets', () => {
    expect(extractClientFromClid('"Caller" <+48515637746>')).toBe('48515637746');
  });

  it('extracts from parens', () => {
    expect(extractClientFromClid('Algeness (48539923725)')).toBe('48539923725');
  });

  it('falls through bare digits', () => {
    expect(extractClientFromClid('48539923725')).toBe('48539923725');
  });

  it('returns SIP-extension parens (caller filters by direction)', () => {
    // For outbound rows the parens contain a SIP extension, useless as a phone.
    // The grouping function uses extractClientFromClid only for inbound rows,
    // so this short value is fine here.
    expect(extractClientFromClid('Paulina 101 (101)')).toBe('101');
  });

  it('empty input', () => {
    expect(extractClientFromClid(undefined)).toBe('');
    expect(extractClientFromClid('')).toBe('');
  });
});

describe('groupAndNormalizeStats', () => {
  const opts = { ourNumber: '48570000808', cabinetTimezone: 'Europe/Warsaw' };

  it('groups multi-leg calls by pbx_call_id', () => {
    const stats: ZadarmaPbxStatRow[] = [
      {
        call_id: '1759098756.12265976',
        pbx_call_id: 'in_abc123',
        sip: '100',
        callstart: '2026-04-28 08:21:16',
        clid: '"Caller" <+48515637746>',
        destination: '48570000808',
        disposition: 'answered',
        seconds: 30,
      },
      {
        call_id: '1759098756.12265980',
        pbx_call_id: 'in_abc123',
        sip: '101',
        callstart: '2026-04-28 08:21:16',
        clid: '"Caller" <+48515637746>',
        destination: '48570000808',
        disposition: 'answered',
        seconds: 12,
      },
    ];

    const { rows, skipped } = groupAndNormalizeStats(stats, opts);
    expect(skipped).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      pbxCallId: 'in_abc123',
      callType: 'IN',
      duration: 42,
      clientNumber: '48515637746',
      ourNumber: '48570000808',
      disposition: 'ANSWERED',
    });
  });

  it('inbound vs outbound from pbx_call_id prefix', () => {
    const stats: ZadarmaPbxStatRow[] = [
      {
        call_id: 'a',
        pbx_call_id: 'out_x1',
        sip: 100,
        callstart: '2026-04-28 09:00:00',
        clid: 'Paulina 100 (100)',
        destination: '48792010388',
        disposition: 'no answer',
        seconds: 0,
      },
      {
        call_id: 'b',
        pbx_call_id: 'in_y2',
        sip: 100,
        callstart: '2026-04-28 09:01:00',
        clid: 'External (48515637746)',
        destination: '48570000808',
        disposition: 'busy',
        seconds: 5,
      },
    ];
    const { rows } = groupAndNormalizeStats(stats, opts);
    expect(rows).toHaveLength(2);
    const out = rows.find((r) => r.pbxCallId === 'out_x1');
    const inn = rows.find((r) => r.pbxCallId === 'in_y2');
    expect(out?.callType).toBe('OUT');
    expect(out?.clientNumber).toBe('48792010388');
    expect(out?.ourNumber).toBe('48570000808');
    expect(out?.disposition).toBe('NO_ANSWER');
    expect(inn?.callType).toBe('IN');
    expect(inn?.clientNumber).toBe('48515637746');
    expect(inn?.ourNumber).toBe('48570000808');
    expect(inn?.disposition).toBe('BUSY');
  });

  it('skips rows with empty pbx_call_id', () => {
    const stats: ZadarmaPbxStatRow[] = [
      { call_id: 'a', pbx_call_id: '', callstart: '2026-04-28 08:00:00' },
      { call_id: 'b', pbx_call_id: 'in_z3', callstart: '2026-04-28 08:01:00', clid: '48000000111', destination: '48570000808' },
    ];
    const { rows, skipped } = groupAndNormalizeStats(stats, opts);
    expect(skipped).toBe(1);
    expect(rows).toHaveLength(1);
  });

  it('callStart converts cabinet wall-clock → UTC ISO', () => {
    const stats: ZadarmaPbxStatRow[] = [
      {
        call_id: 'a',
        pbx_call_id: 'in_z4',
        callstart: '2026-07-15 14:30:00',
        clid: '48000000111',
        destination: '48570000808',
      },
    ];
    const { rows } = groupAndNormalizeStats(stats, opts);
    // Europe/Warsaw in July = CEST = UTC+2 → 14:30 local = 12:30 UTC
    expect(rows[0].callStart).toBe('2026-07-15T12:30:00.000Z');
  });

  it('callStart stays null when cabinet timezone is empty', () => {
    const stats: ZadarmaPbxStatRow[] = [
      {
        pbx_call_id: 'in_z5',
        callstart: '2026-07-15 14:30:00',
        clid: '48000000111',
      },
    ];
    const { rows } = groupAndNormalizeStats(stats, {
      ourNumber: '48570000808',
      cabinetTimezone: '',
    });
    expect(rows[0].callStart).toBeNull();
  });

  it('internal extension "0" → null', () => {
    const stats: ZadarmaPbxStatRow[] = [
      { pbx_call_id: 'in_z6', sip: '0', clid: '48000000111' },
      { pbx_call_id: 'in_z7', sip: '100', clid: '48000000111' },
    ];
    const { rows } = groupAndNormalizeStats(stats, opts);
    expect(rows.find((r) => r.pbxCallId === 'in_z6')?.internalExtension).toBeNull();
    expect(rows.find((r) => r.pbxCallId === 'in_z7')?.internalExtension).toBe(
      '100',
    );
  });

  it('rows are sorted by pbxCallId for stable output', () => {
    const stats: ZadarmaPbxStatRow[] = [
      { pbx_call_id: 'out_z' },
      { pbx_call_id: 'in_a' },
      { pbx_call_id: 'in_m' },
    ];
    const { rows } = groupAndNormalizeStats(stats, opts);
    expect(rows.map((r) => r.pbxCallId)).toEqual(['in_a', 'in_m', 'out_z']);
  });

  it('name format includes direction + client + truncated callstart', () => {
    const stats: ZadarmaPbxStatRow[] = [
      {
        pbx_call_id: 'in_xx',
        callstart: '2026-04-28 08:21:16',
        clid: '48515637746',
      },
    ];
    const { rows } = groupAndNormalizeStats(stats, opts);
    expect(rows[0].name).toBe('IN 48515637746 — 2026-04-28 08:21');
  });
});
