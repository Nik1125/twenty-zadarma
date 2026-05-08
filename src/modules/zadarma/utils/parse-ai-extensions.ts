// Parse the AI_EXTENSIONS applicationVariable.
// Format: comma-separated digits (whitespace tolerated). Examples: "103,105",
// "  103, 104, 105 ", "" (empty). Non-digit tokens are filtered out — the
// extension list is a security/correctness boundary, not a free-text field.
export const parseAiExtensions = (raw: string | undefined): string[] => {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s));
};
