import { afterEach, describe, expect, it } from 'vitest';

import {
  computeCooldownUntilIso,
  parseCooldownMinutes,
  resolveCooldownUntilIso,
} from './active-call-lock';

const ORIGINAL_ENV = process.env.ACTIVE_CALL_COOLDOWN_MINUTES;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.ACTIVE_CALL_COOLDOWN_MINUTES;
  } else {
    process.env.ACTIVE_CALL_COOLDOWN_MINUTES = ORIGINAL_ENV;
  }
});

describe('parseCooldownMinutes', () => {
  it('returns 5 (default) when env is undefined', () => {
    expect(parseCooldownMinutes(undefined)).toBe(5);
  });

  it('returns 5 when env is empty / whitespace', () => {
    expect(parseCooldownMinutes('')).toBe(5);
    expect(parseCooldownMinutes('   ')).toBe(5);
  });

  it('returns 5 for non-numeric strings', () => {
    expect(parseCooldownMinutes('abc')).toBe(5);
  });

  it('returns 5 for zero / negative values', () => {
    expect(parseCooldownMinutes('0')).toBe(5);
    expect(parseCooldownMinutes('-3')).toBe(5);
  });

  it('parses valid positive integers', () => {
    expect(parseCooldownMinutes('1')).toBe(1);
    expect(parseCooldownMinutes('15')).toBe(15);
    expect(parseCooldownMinutes('120')).toBe(120);
  });

  it('parses fractional minutes (allowed for tight tuning)', () => {
    expect(parseCooldownMinutes('0.5')).toBe(0.5);
  });

  it('clamps absurd values to MAX_COOLDOWN_MINUTES (1 day)', () => {
    expect(parseCooldownMinutes('99999')).toBe(1440);
  });
});

describe('computeCooldownUntilIso', () => {
  it('adds N minutes to a known epoch', () => {
    // 2026-01-01T00:00:00.000Z = 1767225600000 ms
    const baseMs = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(computeCooldownUntilIso(baseMs, 5)).toBe('2026-01-01T00:05:00.000Z');
    expect(computeCooldownUntilIso(baseMs, 30)).toBe('2026-01-01T00:30:00.000Z');
  });

  it('handles fractional minutes', () => {
    const baseMs = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(computeCooldownUntilIso(baseMs, 0.5)).toBe('2026-01-01T00:00:30.000Z');
  });

  it('handles cross-midnight rollover', () => {
    const baseMs = Date.UTC(2026, 0, 1, 23, 58, 0);
    expect(computeCooldownUntilIso(baseMs, 5)).toBe('2026-01-02T00:03:00.000Z');
  });
});

describe('resolveCooldownUntilIso', () => {
  it('uses ACTIVE_CALL_COOLDOWN_MINUTES env when set', () => {
    process.env.ACTIVE_CALL_COOLDOWN_MINUTES = '10';
    const baseMs = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(resolveCooldownUntilIso(baseMs)).toBe('2026-01-01T00:10:00.000Z');
  });

  it('falls back to 5 minutes when env is unset', () => {
    delete process.env.ACTIVE_CALL_COOLDOWN_MINUTES;
    const baseMs = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(resolveCooldownUntilIso(baseMs)).toBe('2026-01-01T00:05:00.000Z');
  });

  it('falls back to 5 minutes when env is garbage', () => {
    process.env.ACTIVE_CALL_COOLDOWN_MINUTES = 'not-a-number';
    const baseMs = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(resolveCooldownUntilIso(baseMs)).toBe('2026-01-01T00:05:00.000Z');
  });
});
