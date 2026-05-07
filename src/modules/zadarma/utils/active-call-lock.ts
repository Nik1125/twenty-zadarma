// Helpers for the Person.activeCallStatus dial-lock signal. Pure functions
// so the cooldown math and env parsing are unit-testable without dragging
// the whole webhook handler into a test bench.

const DEFAULT_COOLDOWN_MINUTES = 5;
const MAX_COOLDOWN_MINUTES = 24 * 60; // 1 day — anything longer suggests misconfiguration

// ACTIVE_CALL_COOLDOWN_MINUTES is a string applicationVariable. Anything
// non-positive, non-finite, or absurdly large falls back to 5 minutes so a
// single bad config does not silently park Persons in cooldown forever.
export const parseCooldownMinutes = (raw: string | undefined): number => {
  if (raw === undefined) return DEFAULT_COOLDOWN_MINUTES;
  const trimmed = raw.trim();
  if (trimmed === '') return DEFAULT_COOLDOWN_MINUTES;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_COOLDOWN_MINUTES;
  if (parsed > MAX_COOLDOWN_MINUTES) return MAX_COOLDOWN_MINUTES;
  return parsed;
};

export const computeCooldownUntilIso = (
  nowMs: number,
  cooldownMinutes: number,
): string =>
  new Date(nowMs + cooldownMinutes * 60_000).toISOString();

// Convenience for callers that already hold an Env value. Centralising the
// lookup means the ACTIVE_CALL_COOLDOWN_MINUTES applicationVariable name is
// referenced exactly once outside application-config.ts.
export const resolveCooldownUntilIso = (nowMs: number = Date.now()): string =>
  computeCooldownUntilIso(
    nowMs,
    parseCooldownMinutes(process.env.ACTIVE_CALL_COOLDOWN_MINUTES),
  );
