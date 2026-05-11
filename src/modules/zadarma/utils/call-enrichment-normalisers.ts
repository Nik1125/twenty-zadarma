// Pure normalisers for the /zadarma/call-enrichment endpoint. Extracted
// from the logic function so they can be unit-tested independently from the
// network round-trip. Every function tolerates `undefined` / wrong shape /
// out-of-range without throwing — returning `null` when the value can't be
// safely written to the corresponding callLog column.

export type Sentiment = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'UNKNOWN';

export type ActionRequired =
  | 'NONE'
  | 'SMS_FOLLOWUP'
  | 'EMAIL_OFFER'
  | 'CALLBACK'
  | 'OPERATOR_TASK'
  | 'HUMAN_TRANSFER'
  | 'DO_NOT_CONTACT';

export type Outcome =
  | 'WON'
  | 'LOST'
  | 'FOLLOWUP'
  | 'DISQUALIFIED'
  | 'NO_CONTACT'
  | 'CALLBACK'
  | 'INCOMPLETE'
  | 'OTHER';

export type KeyFact = { type: string; value: string };

const SENTIMENT_VALUES: ReadonlySet<Sentiment> = new Set([
  'POSITIVE',
  'NEGATIVE',
  'NEUTRAL',
  'UNKNOWN',
]);

const ACTION_VALUES: ReadonlySet<ActionRequired> = new Set([
  'NONE',
  'SMS_FOLLOWUP',
  'EMAIL_OFFER',
  'CALLBACK',
  'OPERATOR_TASK',
  'HUMAN_TRANSFER',
  'DO_NOT_CONTACT',
]);

const OUTCOME_VALUES: ReadonlySet<Outcome> = new Set([
  'WON',
  'LOST',
  'FOLLOWUP',
  'DISQUALIFIED',
  'NO_CONTACT',
  'CALLBACK',
  'INCOMPLETE',
  'OTHER',
]);

export const normaliseSentiment = (raw: unknown): Sentiment | null => {
  if (typeof raw !== 'string') return null;
  const upper = raw.trim().toUpperCase();
  return SENTIMENT_VALUES.has(upper as Sentiment) ? (upper as Sentiment) : null;
};

export const normaliseAction = (raw: unknown): ActionRequired | null => {
  if (typeof raw !== 'string') return null;
  const upper = raw.trim().toUpperCase();
  return ACTION_VALUES.has(upper as ActionRequired)
    ? (upper as ActionRequired)
    : null;
};

export const normaliseOutcome = (raw: unknown): Outcome | null => {
  if (typeof raw !== 'string') return null;
  const upper = raw.trim().toUpperCase();
  return OUTCOME_VALUES.has(upper as Outcome) ? (upper as Outcome) : null;
};

export const normaliseKeyTopics = (raw: unknown): string[] | null => {
  if (!Array.isArray(raw)) return null;
  const out = raw
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return out.length > 0 ? out : null;
};

// 1-5 inclusive, rounded. Out-of-range values clamp toward the nearest end
// rather than reject the whole enrichment write — a stray 0 or 6 from the
// analyser shouldn't drop the rest of the payload.
export const normaliseInterestLevel = (raw: unknown): number | null => {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return Math.max(1, Math.min(5, Math.round(raw)));
};

// Score is 1-5 but 0 (or any sub-1 value) collapses to null = "skip" —
// matches the analyser convention "score=0 when the call was not a real
// conversation". Dashboards then need no extra filter to exclude skips.
export const normaliseScore = (raw: unknown): number | null => {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const rounded = Math.round(raw);
  if (rounded < 1) return null;
  return Math.min(5, rounded);
};

// Drops entries missing either `type` or `value` (or with non-string values).
// Returns null when nothing survives, so the enrichment handler can skip the
// write entirely.
export const normaliseKeyFacts = (raw: unknown): KeyFact[] | null => {
  if (!Array.isArray(raw)) return null;
  const out: KeyFact[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const obj = entry as Record<string, unknown>;
    const type = typeof obj.type === 'string' ? obj.type.trim() : '';
    const value = typeof obj.value === 'string' ? obj.value.trim() : '';
    if (type.length === 0 || value.length === 0) continue;
    out.push({ type, value });
  }
  return out.length > 0 ? out : null;
};

// One-shot deprecation warnings — the warned set lives for the process
// lifetime so a noisy adapter doesn't flood the logs.
const warnedLegacyKeys = new Set<string>();

// Resets the legacy-key warning cache. Exposed for unit tests; production
// code never calls it.
export const __resetLegacyKeyWarnings = (): void => {
  warnedLegacyKeys.clear();
};

const warnLegacyKey = (legacyKey: string, newKey: string): void => {
  if (warnedLegacyKeys.has(legacyKey)) return;
  warnedLegacyKeys.add(legacyKey);
  console.warn(
    `[call-enrichment] deprecated payload key "${legacyKey}" — switch your adapter to "${newKey}" (v0.25.0; legacy keys accepted for back-compat).`,
  );
};

// Picks the new universal key when present; falls back to the legacy
// `ai*`-prefixed key otherwise (and emits a one-shot deprecation warning).
// Used by every dual-key field on the enrichment endpoint.
export const pickEnrichmentKey = <T>(
  newVal: T | undefined,
  legacyVal: T | undefined,
  legacyKeyName: string,
  newKeyName: string,
): T | undefined => {
  if (newVal !== undefined) return newVal;
  if (legacyVal !== undefined) {
    warnLegacyKey(legacyKeyName, newKeyName);
    return legacyVal;
  }
  return undefined;
};
