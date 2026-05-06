// Strips everything except digits and returns E.164 without leading '+'.
// Examples: '+48 573 580 808' → '48573580808', '+1 (555) 123-4567' → '15551234567'.
// Returns null for empty / phone-less input so the caller can decide what to do.
export const normalizePhone = (raw: string | null | undefined): string | null => {
  if (raw == null) return null;
  const digits = raw.replace(/\D+/g, '');
  return digits.length === 0 ? null : digits;
};
