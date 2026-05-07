// Shared helpers for transformer scripts.
//
// Zero runtime deps — pure Node built-ins. Run any transformer as:
//   node scripts/transformers/<name>.mjs <input> <output>
//
// Type hints via JSDoc; no compile step.

/**
 * Parse a delimiter-separated text file into an array of plain objects keyed
 * by header. Handles double-quote escaping per RFC 4180. Skips empty lines.
 *
 * @param {string} text
 * @param {string} delimiter — default ','
 * @returns {Array<Record<string, string>>}
 */
export const parseDelimited = (text, delimiter = ',') => {
  const rows = parseRows(text, delimiter);
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1).map((row) => {
    const obj = {};
    header.forEach((col, i) => {
      obj[col] = row[i] ?? '';
    });
    return obj;
  });
};

/**
 * Parse text into an array of arrays — one row per line, one cell per column.
 * RFC 4180 (quoted cells, quote-doubling for literal quotes).
 *
 * @param {string} text
 * @param {string} delimiter
 * @returns {Array<Array<string>>}
 */
const parseRows = (text, delimiter) => {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      row.push(cell);
      cell = '';
      i++;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      // CRLF or LF row terminator. Push cell + row, then skip the rest of
      // the terminator chars so we don't emit a phantom empty row.
      row.push(cell);
      cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      while (i < text.length && (text[i] === '\n' || text[i] === '\r')) i++;
      continue;
    }
    cell += ch;
    i++;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
};

/**
 * Serialise rows back to RFC 4180 CSV using `,` as delimiter. Quotes any cell
 * that contains `,`, `"`, `\n`, or `\r`. Quotes inside cells are doubled.
 *
 * @param {ReadonlyArray<string>} header
 * @param {ReadonlyArray<Record<string, string | number | undefined | null>>} rows
 * @returns {string}
 */
export const writeCsv = (header, rows) => {
  const lines = [header.map(quote).join(',')];
  for (const row of rows) {
    lines.push(header.map((col) => quote(row[col])).join(','));
  }
  return lines.join('\n') + '\n';
};

/**
 * @param {string | number | undefined | null} value
 * @returns {string}
 */
const quote = (value) => {
  if (value === undefined || value === null) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

/**
 * Convert a wall-clock datetime in a named IANA timezone to a UTC ISO string.
 *
 * Example:
 *   localToUtcIso('2026-04-28 08:21:16', 'Europe/Warsaw')
 *     → '2026-04-28T06:21:16.000Z'  (CEST = UTC+2)
 *
 * Implementation trick: ask Intl.DateTimeFormat what the date `t` looks like
 * in the target timezone; the difference between that wall-clock and `t`
 * itself (interpreted as UTC) is the offset.
 *
 * @param {string} local — `YYYY-MM-DD HH:mm:ss` (or with `T`)
 * @param {string} tz — IANA tz, e.g. 'Europe/Warsaw'
 * @returns {string} ISO 8601 UTC string with millisecond precision
 */
export const localToUtcIso = (local, tz) => {
  const isoLike = local.replace(' ', 'T');
  const [datePart, timePart = '00:00:00'] = isoLike.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm, ss] = timePart.split(':').map(Number);
  // Treat the local wall-clock as if it were UTC — gives us a candidate.
  const candidate = Date.UTC(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, ss ?? 0);
  // Format that candidate in the target tz; the result is the wall-clock
  // value the candidate would represent there.
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
    fmt.formatToParts(new Date(candidate)).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  );
  const tzWallHour = parts.hour === '24' ? 0 : Number(parts.hour);
  const tzWallUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    tzWallHour,
    Number(parts.minute),
    Number(parts.second),
  );
  // The offset (in ms) is how much the tz wall-clock leads the candidate.
  const offsetMs = tzWallUtc - candidate;
  return new Date(candidate - offsetMs).toISOString();
};

/**
 * Strip leading `+` from a phone number, keep digits only otherwise.
 *
 * @param {string | undefined | null} raw
 * @returns {string}
 */
export const e164NoPlus = (raw) => {
  if (!raw) return '';
  return String(raw).replace(/[^\d]/g, '');
};

/**
 * Read an argv slot or print usage + exit.
 * @param {ReadonlyArray<string>} argv — typically process.argv.slice(2)
 * @param {number} index
 * @param {string} usage
 * @returns {string}
 */
export const requireArg = (argv, index, usage) => {
  const value = argv[index];
  if (!value) {
    console.error(usage);
    process.exit(1);
  }
  return value;
};
