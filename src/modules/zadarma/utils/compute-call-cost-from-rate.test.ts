import { describe, it, expect } from 'vitest';

import {
  computeCallCostFromRate,
  costsEqual,
  parseCostRatesFromEnv,
  type CostRates,
} from 'src/modules/zadarma/utils/compute-call-cost-from-rate';

const RATES: CostRates = {
  zadarmaRatePerMinute: 0.05,
  zadarmaCurrency: 'USD',
  aiRatePerMinute: 0.5,
  aiCurrency: 'USD',
};

describe('parseCostRatesFromEnv', () => {
  it('parses valid rate + currency pairs', () => {
    expect(
      parseCostRatesFromEnv({
        ZADARMA_RATE_PER_MINUTE: '0.05',
        ZADARMA_RATE_CURRENCY: 'usd',
        AI_RATE_PER_MINUTE: '0.5',
        AI_RATE_CURRENCY: 'pln',
      }),
    ).toEqual({
      zadarmaRatePerMinute: 0.05,
      zadarmaCurrency: 'USD',
      aiRatePerMinute: 0.5,
      aiCurrency: 'PLN',
    });
  });

  it('treats missing / blank fields as null', () => {
    expect(parseCostRatesFromEnv({})).toEqual({
      zadarmaRatePerMinute: null,
      zadarmaCurrency: null,
      aiRatePerMinute: null,
      aiCurrency: null,
    });
    expect(
      parseCostRatesFromEnv({
        ZADARMA_RATE_PER_MINUTE: '   ',
        ZADARMA_RATE_CURRENCY: '',
      }),
    ).toMatchObject({ zadarmaRatePerMinute: null, zadarmaCurrency: null });
  });

  it('rejects negative rates and non-numeric strings', () => {
    expect(
      parseCostRatesFromEnv({
        ZADARMA_RATE_PER_MINUTE: '-0.5',
        AI_RATE_PER_MINUTE: 'not-a-number',
      }),
    ).toMatchObject({
      zadarmaRatePerMinute: null,
      aiRatePerMinute: null,
    });
  });

  it('rejects currency codes that are not 3 letters', () => {
    expect(
      parseCostRatesFromEnv({
        ZADARMA_RATE_CURRENCY: 'US',
        AI_RATE_CURRENCY: 'DOLLARS',
      }),
    ).toMatchObject({
      zadarmaCurrency: null,
      aiCurrency: null,
    });
  });
});

describe('computeCallCostFromRate', () => {
  it('returns null for inbound calls regardless of rates', () => {
    expect(
      computeCallCostFromRate(
        { callType: 'IN', callerType: 'HUMAN', duration: 600 },
        RATES,
      ),
    ).toBeNull();
  });

  it('uses AI rate for callerType=AI on outbound', () => {
    expect(
      computeCallCostFromRate(
        { callType: 'OUT', callerType: 'AI', duration: 60 },
        RATES,
      ),
    ).toEqual({ amountMicros: 500_000, currencyCode: 'USD' });
  });

  it('uses Zadarma rate for callerType=HUMAN on outbound', () => {
    expect(
      computeCallCostFromRate(
        { callType: 'OUT', callerType: 'HUMAN', duration: 120 },
        RATES,
      ),
    ).toEqual({ amountMicros: 100_000, currencyCode: 'USD' });
  });

  it('uses Zadarma rate for callerType=UNKNOWN on outbound', () => {
    expect(
      computeCallCostFromRate(
        { callType: 'OUT', callerType: 'UNKNOWN', duration: 120 },
        RATES,
      ),
    ).toEqual({ amountMicros: 100_000, currencyCode: 'USD' });
  });

  it('falls back to Zadarma rate when AI rate is not configured', () => {
    const partial: CostRates = {
      zadarmaRatePerMinute: 0.05,
      zadarmaCurrency: 'USD',
      aiRatePerMinute: null,
      aiCurrency: null,
    };
    expect(
      computeCallCostFromRate(
        { callType: 'OUT', callerType: 'AI', duration: 60 },
        partial,
      ),
    ).toEqual({ amountMicros: 50_000, currencyCode: 'USD' });
  });

  it('returns null when no rate is configured', () => {
    expect(
      computeCallCostFromRate(
        { callType: 'OUT', callerType: 'HUMAN', duration: 60 },
        {
          zadarmaRatePerMinute: null,
          zadarmaCurrency: null,
          aiRatePerMinute: null,
          aiCurrency: null,
        },
      ),
    ).toBeNull();
  });

  it('returns null for missing / zero / negative duration', () => {
    expect(
      computeCallCostFromRate(
        { callType: 'OUT', callerType: 'HUMAN', duration: null },
        RATES,
      ),
    ).toBeNull();
    expect(
      computeCallCostFromRate(
        { callType: 'OUT', callerType: 'HUMAN', duration: 0 },
        RATES,
      ),
    ).toBeNull();
    expect(
      computeCallCostFromRate(
        { callType: 'OUT', callerType: 'HUMAN', duration: -10 },
        RATES,
      ),
    ).toBeNull();
  });

  it('rounds float-precision artefacts at the micros boundary', () => {
    // 0.0123 × 1e6 = 12300.000000000002 in IEEE-754. Should round to 12300.
    const r: CostRates = {
      zadarmaRatePerMinute: 0.0123,
      zadarmaCurrency: 'USD',
      aiRatePerMinute: null,
      aiCurrency: null,
    };
    expect(
      computeCallCostFromRate(
        { callType: 'OUT', callerType: 'HUMAN', duration: 60 },
        r,
      ),
    ).toEqual({ amountMicros: 12_300, currencyCode: 'USD' });
  });

  it('handles fractional minutes correctly', () => {
    // 30 seconds at $0.10/min → $0.05 → 50_000 micros
    const r: CostRates = {
      zadarmaRatePerMinute: 0.1,
      zadarmaCurrency: 'USD',
      aiRatePerMinute: null,
      aiCurrency: null,
    };
    expect(
      computeCallCostFromRate(
        { callType: 'OUT', callerType: 'HUMAN', duration: 30 },
        r,
      ),
    ).toEqual({ amountMicros: 50_000, currencyCode: 'USD' });
  });
});

describe('costsEqual', () => {
  it('treats null cost on both sides as equal', () => {
    expect(costsEqual(null, null)).toBe(true);
    expect(costsEqual({ amountMicros: null, currencyCode: null }, null)).toBe(true);
    expect(costsEqual(undefined, null)).toBe(true);
  });

  it('treats matching micros + currency as equal', () => {
    expect(
      costsEqual(
        { amountMicros: 12300, currencyCode: 'USD' },
        { amountMicros: 12300, currencyCode: 'USD' },
      ),
    ).toBe(true);
  });

  it('case-insensitive currency comparison', () => {
    expect(
      costsEqual(
        { amountMicros: 12300, currencyCode: 'usd' },
        { amountMicros: 12300, currencyCode: 'USD' },
      ),
    ).toBe(true);
  });

  it('different micros = not equal', () => {
    expect(
      costsEqual(
        { amountMicros: 12300, currencyCode: 'USD' },
        { amountMicros: 50000, currencyCode: 'USD' },
      ),
    ).toBe(false);
  });

  it('different currency = not equal', () => {
    expect(
      costsEqual(
        { amountMicros: 12300, currencyCode: 'USD' },
        { amountMicros: 12300, currencyCode: 'EUR' },
      ),
    ).toBe(false);
  });

  it('null on one side, computed on the other = not equal', () => {
    expect(costsEqual(null, { amountMicros: 12300, currencyCode: 'USD' })).toBe(false);
    expect(costsEqual({ amountMicros: 12300, currencyCode: 'USD' }, null)).toBe(false);
  });
});
