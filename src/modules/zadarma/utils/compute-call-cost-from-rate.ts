// Pure cost-from-rate computation. Used by sync-zadarma-calls (at insert)
// and /zadarma/recompute-costs (back-fill). Inputs come from the
// applicationVariables ZADARMA_RATE_PER_MINUTE / ZADARMA_RATE_CURRENCY /
// AI_RATE_PER_MINUTE / AI_RATE_CURRENCY plus the per-row callType /
// callerType / duration.
//
// Decision tree (evaluated top-down):
//   AI call & AI rate set            → (duration / 60) × AI rate, AI currency
//                                      Direction-agnostic: AI agents bill for
//                                      handle time whether the call was
//                                      inbound (Retell answered our DID) or
//                                      outbound (Retell dialled out).
//   inbound (callType=IN) & non-AI   → null (called party pays — Zadarma
//                                      inbound is free for typical PL DIDs)
//   outbound & Zadarma rate set      → (duration / 60) × Zadarma rate
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
  // Calls shorter than this are not chargeable — `computeCallCostFromRate`
  // returns null. Matches the typical telecom "minimum chargeable duration"
  // convention so micro-short answered calls (misdials, immediate hang-up,
  // quick verifications) don't show up as 0.01 PLN noise in dashboards.
  // 0 = no threshold (every outbound call with duration > 0 gets a cost).
  minChargeableDurationSeconds: number;
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

const DEFAULT_MIN_CHARGEABLE_DURATION_SECONDS = 15;

const parseThreshold = (raw: string | undefined | null): number => {
  if (raw === undefined || raw === null) return DEFAULT_MIN_CHARGEABLE_DURATION_SECONDS;
  const trimmed = String(raw).trim();
  if (!trimmed) return DEFAULT_MIN_CHARGEABLE_DURATION_SECONDS;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_MIN_CHARGEABLE_DURATION_SECONDS;
  return Math.floor(n);
};

// Parses the rate-related applicationVariables into a typed config. Each
// rate pair (rate + currency) is independent — Zadarma rates can be set
// without AI rates and vice versa. A pair where either half is missing /
// invalid is treated as "not configured" for that callerType bucket. The
// min-chargeable threshold falls back to a 15s default when blank — short
// answered calls then get cost=null, matching common operator billing.
export const parseCostRatesFromEnv = (env: {
  ZADARMA_RATE_PER_MINUTE?: string;
  ZADARMA_RATE_CURRENCY?: string;
  AI_RATE_PER_MINUTE?: string;
  AI_RATE_CURRENCY?: string;
  MIN_CHARGEABLE_DURATION_SECONDS?: string;
}): CostRates => ({
  zadarmaRatePerMinute: parseRate(env.ZADARMA_RATE_PER_MINUTE),
  zadarmaCurrency: parseCurrency(env.ZADARMA_RATE_CURRENCY),
  aiRatePerMinute: parseRate(env.AI_RATE_PER_MINUTE),
  aiCurrency: parseCurrency(env.AI_RATE_CURRENCY),
  minChargeableDurationSeconds: parseThreshold(env.MIN_CHARGEABLE_DURATION_SECONDS),
});

const toMicros = (decimal: number): number =>
  Math.round(decimal * 1_000_000);

export const computeCallCostFromRate = (
  input: ComputeCostInput,
  rates: CostRates,
): ComputedCost | null => {
  if (
    typeof input.duration !== 'number' ||
    !Number.isFinite(input.duration) ||
    input.duration <= 0
  ) {
    return null;
  }
  if (input.duration < rates.minChargeableDurationSeconds) {
    // Short calls (misdial, immediate hang-up) — operator policy: free.
    // Setting MIN_CHARGEABLE_DURATION_SECONDS=0 disables this branch.
    return null;
  }

  // AI calls bill regardless of direction: Retell (and similar) charge for
  // agent handle time whether the agent answered an inbound call or dialled
  // out. Evaluated before the IN-guard so AI inbound rows get a non-null
  // cost.
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

  // Non-AI inbound is free on the typical Zadarma plan (called party pays).
  if (input.callType !== 'OUT') return null;

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
