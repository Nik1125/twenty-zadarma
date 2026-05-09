import { type DialogTurn } from 'src/modules/zadarma/utils/format-transcript-blocknote';

// Zadarma SPEECH_RECOGNITION delivers transcript as nested JSON.
// Webhook shape: result is a JSON-encoded string of `{ words: [...] }`.
// Polling shape (`GET /v1/speech_recognition/?return=words`): the server
// returns `{ status, recognitionStatus, words: [...] }` — same `words[]`
// inner shape, just unwrapped.
//
// Each segment in `words[]`:
//   { result: [ { s, e, w }, ... ], channel?: 1|2 }
// `result[]` is the list of recognised words; `channel` identifies the audio
// channel (only present for stereo recordings — Zadarma writes mono by default
// and the channel is then constant or absent).
export type ZadarmaSpeechSegment = {
  result?: Array<{ s?: number; e?: number; w?: string }>;
  channel?: number;
};

export type ZadarmaSpeechResult = {
  words?: Array<ZadarmaSpeechSegment>;
};

type ParsedSegment = {
  channel: number | null;
  startTime: number;
  text: string;
};

// Accepts:
//   - a JSON string (webhook `result` field)
//   - a parsed object (polling response, or already-decoded webhook payload)
//   - anything else → null
export const extractDialogTurns = (
  rawResult: unknown,
): DialogTurn[] | null => {
  let parsed: ZadarmaSpeechResult | null = null;
  if (typeof rawResult === 'string') {
    try {
      parsed = JSON.parse(rawResult) as ZadarmaSpeechResult;
    } catch {
      return null;
    }
  } else if (rawResult && typeof rawResult === 'object') {
    parsed = rawResult as ZadarmaSpeechResult;
  }
  if (!parsed?.words?.length) return null;

  const segments: ParsedSegment[] = [];
  for (const seg of parsed.words) {
    const wordsList = seg.result ?? [];
    const text = wordsList
      .map((w) => (typeof w.w === 'string' ? w.w : ''))
      .filter((w) => w.length > 0)
      .join(' ');
    if (!text) continue;
    const startTime =
      typeof wordsList[0]?.s === 'number' ? wordsList[0].s : 0;
    segments.push({
      channel: typeof seg.channel === 'number' ? seg.channel : null,
      startTime,
      text,
    });
  }
  if (segments.length === 0) return null;

  // Time-order — robust against any Zadarma reordering inside `words[]`.
  segments.sort((a, b) => a.startTime - b.startTime);

  // Merge consecutive same-channel segments into a single speaker turn so the
  // dialog reads as proper blocks rather than a flood of short phrases.
  const merged: ParsedSegment[] = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (last && last.channel === seg.channel) {
      last.text = `${last.text} ${seg.text}`;
    } else {
      merged.push({ ...seg });
    }
  }

  return merged.map((m) => ({ channel: m.channel, text: m.text }));
};
