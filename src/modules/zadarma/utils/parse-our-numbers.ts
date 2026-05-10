// Parses the OUR_NUMBERS applicationVariable (or the legacy DEFAULT_SENDER_DID)
// into an ordered list of E.164-without-plus numbers used to identify "our"
// outbound DIDs. Used at sync time to stamp the `ourNumber` field on outbound
// callLog rows when Zadarma's stats payload doesn't carry the actual leg DID.
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

export const parseOurNumbers = (csv: string | null | undefined): string[] => {
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

// Resolve the active "our DIDs" list using OUR_NUMBERS first, then the legacy
// single-value DEFAULT_SENDER_DID. Centralises the back-compat fallback so
// every caller (sync, frontend, future per-row classifier) reads the same
// resolved list.
export const resolveOurNumbers = (env: {
  OUR_NUMBERS?: string;
  DEFAULT_SENDER_DID?: string;
}): string[] => {
  const fromList = parseOurNumbers(env.OUR_NUMBERS);
  if (fromList.length > 0) return fromList;
  return parseOurNumbers(env.DEFAULT_SENDER_DID);
};
