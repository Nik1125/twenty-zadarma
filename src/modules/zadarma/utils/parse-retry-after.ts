// Parses a HTTP `Retry-After` header value into seconds.
//
// Spec accepts two formats:
//   1. `delta-seconds` — non-negative integer. e.g. `Retry-After: 60`.
//   2. `HTTP-date`     — RFC 7231 date. e.g. `Retry-After: Wed, 21 Oct 2026 07:28:00 GMT`.
//
// Falls back to a sane default when the header is missing, malformed, or
// resolves to a past timestamp. Callers receive a single number they can
// safely surface to the upstream consumer (n8n, Twenty Workflow, manual UI).
const DEFAULT_RETRY_SECONDS = 60;

export const parseRetryAfter = (
  header: string | null | undefined,
): number => {
  if (header == null) return DEFAULT_RETRY_SECONDS;
  const trimmed = header.trim();
  if (trimmed === '') return DEFAULT_RETRY_SECONDS;

  // Format 1 — delta-seconds.
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    return Number.isFinite(seconds) && seconds >= 0
      ? seconds
      : DEFAULT_RETRY_SECONDS;
  }

  // Format 2 — HTTP-date.
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    const diffSeconds = Math.ceil((dateMs - Date.now()) / 1000);
    return diffSeconds > 0 ? diffSeconds : DEFAULT_RETRY_SECONDS;
  }

  return DEFAULT_RETRY_SECONDS;
};
