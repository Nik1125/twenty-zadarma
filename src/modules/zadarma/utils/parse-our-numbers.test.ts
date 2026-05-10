import { describe, expect, it } from 'vitest';

import { parseOurNumbers, resolveOurNumbers } from './parse-our-numbers';

describe('parseOurNumbers', () => {
  it('returns empty array for null/undefined/empty', () => {
    expect(parseOurNumbers(null)).toEqual([]);
    expect(parseOurNumbers(undefined)).toEqual([]);
    expect(parseOurNumbers('')).toEqual([]);
    expect(parseOurNumbers('   ')).toEqual([]);
  });

  it('extracts a single E.164 number', () => {
    expect(parseOurNumbers('48579872402')).toEqual(['48579872402']);
  });

  it('strips formatting characters (+, spaces, dashes)', () => {
    expect(parseOurNumbers('+48 579-872 402')).toEqual(['48579872402']);
  });

  it('splits comma-separated lists', () => {
    expect(parseOurNumbers('48579872402,380501234567')).toEqual([
      '48579872402',
      '380501234567',
    ]);
  });

  it('handles whitespace and the + prefix in each entry', () => {
    expect(parseOurNumbers('+48 579 872 402, +380 50 1234567')).toEqual([
      '48579872402',
      '380501234567',
    ]);
  });

  it('skips empty fragments', () => {
    expect(parseOurNumbers('48579872402,,,380501234567')).toEqual([
      '48579872402',
      '380501234567',
    ]);
  });

  it('skips entries below the minimum length', () => {
    expect(parseOurNumbers('48579872402,123,380501234567')).toEqual([
      '48579872402',
      '380501234567',
    ]);
  });

  it('drops non-digit-only fragments', () => {
    expect(parseOurNumbers('foo,48579872402,bar')).toEqual(['48579872402']);
  });

  it('deduplicates within the list, preserving first occurrence', () => {
    expect(parseOurNumbers('48579872402,48579872402,380501234567')).toEqual([
      '48579872402',
      '380501234567',
    ]);
  });
});

describe('resolveOurNumbers', () => {
  it('returns OUR_NUMBERS when present', () => {
    expect(
      resolveOurNumbers({
        OUR_NUMBERS: '48579872402,380501234567',
        DEFAULT_SENDER_DID: '11111111111',
      }),
    ).toEqual(['48579872402', '380501234567']);
  });

  it('falls back to DEFAULT_SENDER_DID when OUR_NUMBERS empty', () => {
    expect(
      resolveOurNumbers({
        OUR_NUMBERS: '',
        DEFAULT_SENDER_DID: '48579872402',
      }),
    ).toEqual(['48579872402']);
  });

  it('falls back when OUR_NUMBERS undefined', () => {
    expect(
      resolveOurNumbers({
        DEFAULT_SENDER_DID: '48579872402',
      }),
    ).toEqual(['48579872402']);
  });

  it('returns empty when both are missing', () => {
    expect(resolveOurNumbers({})).toEqual([]);
  });
});
