// Derives callLog.callerType from the Zadarma webhook payload.
//
// Rule:
//   - no internalExtension on the call (typical for missed inbound calls)
//     → UNKNOWN (we genuinely don't know who would have answered)
//   - extension present and listed in AI_EXTENSIONS → AI
//   - extension present and NOT listed in AI_EXTENSIONS → HUMAN
//
// `aiExtensions` is the parsed AI_EXTENSIONS applicationVariable (see
// parse-ai-extensions.ts). Empty list = no extension is AI = every call with
// an extension is HUMAN.

export type CallerType = 'HUMAN' | 'AI' | 'UNKNOWN';

export const deriveCallerType = (
  internalExtension: string | null | undefined,
  aiExtensions: readonly string[],
): CallerType => {
  const trimmed = internalExtension?.trim();
  if (!trimmed) return 'UNKNOWN';
  return aiExtensions.includes(trimmed) ? 'AI' : 'HUMAN';
};
