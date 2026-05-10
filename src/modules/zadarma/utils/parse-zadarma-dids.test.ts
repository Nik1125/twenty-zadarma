import { describe, expect, it } from 'vitest';

import { parseZadarmaDids } from './parse-zadarma-dids';

describe('parseZadarmaDids', () => {
  it('returns empty array for null/undefined/empty', () => {
    expect(parseZadarmaDids(null)).toEqual([]);
    expect(parseZadarmaDids(undefined)).toEqual([]);
    expect(parseZadarmaDids('')).toEqual([]);
    expect(parseZadarmaDids('   ')).toEqual([]);
  });

  it('extracts a single E.164 number', () => {
    expect(parseZadarmaDids('48579872402')).toEqual(['48579872402']);
  });

  it('strips formatting characters (+, spaces, dashes)', () => {
    expect(parseZadarmaDids('+48 579-872 402')).toEqual(['48579872402']);
  });

  it('splits comma-separated lists, preserving order', () => {
    expect(parseZadarmaDids('48579872402,380501234567')).toEqual([
      '48579872402',
      '380501234567',
    ]);
  });

  it('handles whitespace and the + prefix in each entry', () => {
    expect(parseZadarmaDids('+48 579 872 402, +380 50 1234567')).toEqual([
      '48579872402',
      '380501234567',
    ]);
  });

  it('skips empty fragments', () => {
    expect(parseZadarmaDids('48579872402,,,380501234567')).toEqual([
      '48579872402',
      '380501234567',
    ]);
  });

  it('skips entries below the minimum length', () => {
    expect(parseZadarmaDids('48579872402,123,380501234567')).toEqual([
      '48579872402',
      '380501234567',
    ]);
  });

  it('drops non-digit-only fragments', () => {
    expect(parseZadarmaDids('foo,48579872402,bar')).toEqual(['48579872402']);
  });

  it('deduplicates, preserving first occurrence (= default)', () => {
    expect(
      parseZadarmaDids('48579872402,48579872402,380501234567'),
    ).toEqual(['48579872402', '380501234567']);
  });
});
