import { afterEach, describe, expect, it } from 'vitest';

import {
  parseEnrichmentWindowSeconds,
  resolveEnrichmentWindowSeconds,
} from './parse-enrichment-window';

const ORIGINAL_ENV = process.env.CALL_ENRICHMENT_WINDOW_SECONDS;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.CALL_ENRICHMENT_WINDOW_SECONDS;
  } else {
    process.env.CALL_ENRICHMENT_WINDOW_SECONDS = ORIGINAL_ENV;
  }
});

describe('parseEnrichmentWindowSeconds', () => {
  it('returns 90 (default) for undefined / empty / garbage', () => {
    expect(parseEnrichmentWindowSeconds(undefined)).toBe(90);
    expect(parseEnrichmentWindowSeconds('')).toBe(90);
    expect(parseEnrichmentWindowSeconds('abc')).toBe(90);
    expect(parseEnrichmentWindowSeconds('-5')).toBe(90);
    expect(parseEnrichmentWindowSeconds('0')).toBe(90);
  });

  it('clamps to 1 minimum', () => {
    expect(parseEnrichmentWindowSeconds('0.5')).toBe(1);
  });

  it('clamps to 600 max', () => {
    expect(parseEnrichmentWindowSeconds('99999')).toBe(600);
  });

  it('parses valid values', () => {
    expect(parseEnrichmentWindowSeconds('30')).toBe(30);
    expect(parseEnrichmentWindowSeconds('60')).toBe(60);
    expect(parseEnrichmentWindowSeconds('120')).toBe(120);
  });
});

describe('resolveEnrichmentWindowSeconds', () => {
  it('uses request override when valid', () => {
    expect(resolveEnrichmentWindowSeconds(60)).toBe(60);
    expect(resolveEnrichmentWindowSeconds(30)).toBe(30);
  });

  it('clamps override to bounds', () => {
    expect(resolveEnrichmentWindowSeconds(0.5)).toBe(1);
    expect(resolveEnrichmentWindowSeconds(99999)).toBe(600);
  });

  it('falls back to env when override missing or invalid', () => {
    process.env.CALL_ENRICHMENT_WINDOW_SECONDS = '45';
    expect(resolveEnrichmentWindowSeconds(undefined)).toBe(45);
    expect(resolveEnrichmentWindowSeconds(0)).toBe(45);
    expect(resolveEnrichmentWindowSeconds(-10)).toBe(45);
  });

  it('falls back to default 90 when both override and env missing', () => {
    delete process.env.CALL_ENRICHMENT_WINDOW_SECONDS;
    expect(resolveEnrichmentWindowSeconds(undefined)).toBe(90);
  });
});
