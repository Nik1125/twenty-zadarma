// Parses the ZADARMA_DIDS applicationVariable into an ordered list of
// E.164-without-plus numbers. The first entry is the **default** DID —
// used as the stamp on outbound callLog rows when Zadarma's stats payload
// doesn't carry the actual leg DID, and as the default sender in the
// Person panel SMS form.
//
// Inputs that look like phone numbers are kept (digits only, length >= 6).
// Anything else (separators, empty fragments, garbage) is silently dropped.
//
// Examples:
//   ''                                     → []
//   '48579872402'                          → ['48579872402']
//   '+48 579 872 402, +380 50 1234567'     → ['48579872402', '380501234567']
//   '48579872402,,, 380501234567'          → ['48579872402', '380501234567']
//   'foo,bar,baz'                          → []
const MIN_DIGITS = 6;

export const parseZadarmaDids = (
  csv: string | null | undefined,
): string[] => {
  if (csv == null) return [];
  const trimmed = csv.trim();
  if (trimmed === '') return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of trimmed.split(',')) {
    const digits = raw.replace(/\D+/g, '');
    if (digits.length < MIN_DIGITS) continue;
    if (seen.has(digits)) continue;
    seen.add(digits);
    out.push(digits);
  }
  return out;
};
