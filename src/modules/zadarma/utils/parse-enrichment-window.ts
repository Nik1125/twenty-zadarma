// Parse CALL_ENRICHMENT_WINDOW_SECONDS env. Clamps to [1, 600]; falls back to
// 90 for empty/garbage. Mirrors the parseCooldownMinutes pattern (range +
// fallback) so misconfigured values never blow up the endpoint.
const DEFAULT_WINDOW_SECONDS = 90;
const MIN_WINDOW_SECONDS = 1;
const MAX_WINDOW_SECONDS = 600;

export const parseEnrichmentWindowSeconds = (raw: string | undefined): number => {
  if (raw === undefined) return DEFAULT_WINDOW_SECONDS;
  const trimmed = raw.trim();
  if (trimmed === '') return DEFAULT_WINDOW_SECONDS;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_WINDOW_SECONDS;
  if (parsed < MIN_WINDOW_SECONDS) return MIN_WINDOW_SECONDS;
  if (parsed > MAX_WINDOW_SECONDS) return MAX_WINDOW_SECONDS;
  return parsed;
};

export const resolveEnrichmentWindowSeconds = (override: number | undefined): number => {
  if (override !== undefined && Number.isFinite(override) && override > 0) {
    if (override < MIN_WINDOW_SECONDS) return MIN_WINDOW_SECONDS;
    if (override > MAX_WINDOW_SECONDS) return MAX_WINDOW_SECONDS;
    return override;
  }
  return parseEnrichmentWindowSeconds(process.env.CALL_ENRICHMENT_WINDOW_SECONDS);
};
