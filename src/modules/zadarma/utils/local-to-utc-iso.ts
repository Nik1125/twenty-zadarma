// Convert a wall-clock datetime in a named IANA timezone to a UTC ISO string.
//
// Zadarma's PBX webhook delivers `call_start` as `"YYYY-MM-DD HH:mm:ss"` in the
// Zadarma cabinet's display timezone (Europe/Warsaw by default for PL accounts).
// `new Date(string)` parses such an unsuffixed timestamp in the *server's*
// local timezone — Twenty's container runs UTC, so a 22:00 Warsaw value is
// interpreted as 22:00 UTC and stored 2h ahead of reality. This helper does
// the conversion correctly via `Intl.DateTimeFormat`.
//
// Example: localToUtcIso('2026-05-07 22:00:00', 'Europe/Warsaw')
//   → '2026-05-07T20:00:00.000Z' (CEST = UTC+2)
//
// Returns `null` if `local` is empty or unparseable, so callers can fall back
// to `new Date().toISOString()` without crashing.
export const localToUtcIso = (
  local: string | null | undefined,
  tz: string,
): string | null => {
  if (!local) return null;
  const isoLike = local.replace(' ', 'T');
  const [datePart, timePart = '00:00:00'] = isoLike.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm, ss] = timePart.split(':').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return null;
  }
  const candidate = Date.UTC(
    y,
    (m ?? 1) - 1,
    d ?? 1,
    hh ?? 0,
    mm ?? 0,
    ss ?? 0,
  );
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt
      .formatToParts(new Date(candidate))
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const tzWallHour = parts.hour === '24' ? 0 : Number(parts.hour);
  const tzWallUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    tzWallHour,
    Number(parts.minute),
    Number(parts.second),
  );
  const offsetMs = tzWallUtc - candidate;
  return new Date(candidate - offsetMs).toISOString();
};
