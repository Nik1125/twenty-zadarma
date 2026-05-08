// Inverse of localToUtcIso: render a UTC ISO instant as the wall-clock string
// it shows up as in the named IANA timezone, in the format Zadarma's
// `/v1/statistics/pbx/` endpoint expects for `start` / `end` parameters:
// `YYYY-MM-DD HH:mm:ss`. Naive — no offset suffix — because the endpoint
// interprets the value in the cabinet's display tz.
export const utcIsoToTzWallClock = (isoUtc: string, tz: string): string => {
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
      .formatToParts(new Date(isoUtc))
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const hh = parts.hour === '24' ? '00' : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day} ${hh}:${parts.minute}:${parts.second}`;
};
