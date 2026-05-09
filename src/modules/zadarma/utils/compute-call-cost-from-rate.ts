// Pure cost-from-rate computation. Used by sync-zadarma-calls (at insert)
// and /zadarma/recompute-costs (back-fill). Inputs come from the
// applicationVariables ZADARMA_RATE_PER_MINUTE / ZADARMA_RATE_CURRENCY /
// AI_RATE_PER_MINUTE / AI_RATE_CURRENCY plus the per-row callType /
// callerType / duration.
//
// Decision tree:
//   inbound (callType=IN)            → null (called party pays)
//   AI call & AI rate set            → (duration / 60) × AI rate, AI currency
//   any other outbound & Zadarma rate set → (duration / 60) × Zadarma rate
//   anything else                    → null (rate not configured / unparseable)
//
// Cost is stored in Twenty's CURRENCY field shape (`amountMicros` integer +
// `currencyCode` 3-letter ISO). Conversion uses Math.round to defuse
// IEEE-754 artefacts at the 7th decimal place (e.g. 0.0123 * 1e6 =
// 12300.000000000002 → 12300 micros).

export type CostRates = {
  zadarmaRatePerMinute: number | null;
  zadarmaCurrency: string | null;
  aiRatePerMinute: number | null;
  aiCurrency: string | null;
};

export type ComputeCostInput = {
  callType: 'IN' | 'OUT' | null;
  callerType: 'HUMAN' | 'AI' | 'UNKNOWN' | null;
  duration: number | null;
};

export type ComputedCost = {
  amountMicros: number;
  currencyCode: string;
};

const parseRate = (raw: string | undefined | null): number | null => {
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
};

const parseCurrency = (raw: string | undefined | null): string | null => {
  if (raw === undefined || raw === null) return null;
  const c = String(raw).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) return null;
  return c;
};

// Parses the four rate-related applicationVariables into a typed config.
// Each pair (rate + currency) is independent — Zadarma rates can be set
// without AI rates and vice versa. A pair where either half is missing /
// invalid is treated as "not configured" for that callerType bucket.
export const parseCostRatesFromEnv = (env: {
  ZADARMA_RATE_PER_MINUTE?: string;
  ZADARMA_RATE_CURRENCY?: string;
  AI_RATE_PER_MINUTE?: string;
  AI_RATE_CURRENCY?: string;
}): CostRates => ({
  zadarmaRatePerMinute: parseRate(env.ZADARMA_RATE_PER_MINUTE),
  zadarmaCurrency: parseCurrency(env.ZADARMA_RATE_CURRENCY),
  aiRatePerMinute: parseRate(env.AI_RATE_PER_MINUTE),
  aiCurrency: parseCurrency(env.AI_RATE_CURRENCY),
});

const toMicros = (decimal: number): number =>
  Math.round(decimal * 1_000_000);

export const computeCallCostFromRate = (
  input: ComputeCostInput,
  rates: CostRates,
): ComputedCost | null => {
  if (input.callType !== 'OUT') return null;
  if (
    typeof input.duration !== 'number' ||
    !Number.isFinite(input.duration) ||
    input.duration <= 0
  ) {
    return null;
  }

  const useAi =
    input.callerType === 'AI' &&
    rates.aiRatePerMinute !== null &&
    rates.aiCurrency !== null;
  if (useAi) {
    const decimal = (input.duration / 60) * (rates.aiRatePerMinute as number);
    return {
      amountMicros: toMicros(decimal),
      currencyCode: rates.aiCurrency as string,
    };
  }

  if (
    rates.zadarmaRatePerMinute !== null &&
    rates.zadarmaCurrency !== null
  ) {
    const decimal =
      (input.duration / 60) * (rates.zadarmaRatePerMinute as number);
    return {
      amountMicros: toMicros(decimal),
      currencyCode: rates.zadarmaCurrency as string,
    };
  }

  return null;
};

// Equality helper used by /zadarma/recompute-costs to skip mutations that
// would not change the stored cost (saves DB writes when re-running the
// recompute over a fresh dataset). Treats both halves as required — a row
// with only amountMicros set is considered different from one with both
// fields populated.
export const costsEqual = (
  a: { amountMicros?: number | null; currencyCode?: string | null } | null | undefined,
  b: ComputedCost | null,
): boolean => {
  const aMicros = a?.amountMicros ?? null;
  const aCurrency = (a?.currencyCode ?? '').trim().toUpperCase() || null;
  if (b === null) {
    return aMicros === null && aCurrency === null;
  }
  if (aMicros === null || aCurrency === null) return false;
  return aMicros === b.amountMicros && aCurrency === b.currencyCode;
};
