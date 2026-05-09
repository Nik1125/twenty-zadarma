import { signZadarmaRequest } from 'src/modules/zadarma/connector/sign-request';
import { type DialogTurn } from 'src/modules/zadarma/utils/format-transcript-blocknote';
import { extractDialogTurns } from 'src/modules/zadarma/utils/parse-speech-recognition';

// Wraps `GET /v1/speech_recognition/?call_id=&return=words` for sync /
// backfill enrichment.
//
// Endpoint requires `call_id` (Asterisk channel id from stats response —
// distinct from `pbx_call_id`). Legacy callLog rows synced before v0.17.0
// store only `pbx_call_id`; the sync pipeline now also persists
// `callLog.callId` so transcript backfill works for newly-synced rows.
//
// Recognition status flow:
//   - "recognized"            → words[] is populated; parse → DialogTurn[]
//   - "in progress"           → still processing; caller can retry later
//   - "ready for recognize"   → recording exists but not auto-recognised
//                                (paid feature; we DO NOT trigger via PUT)
//   - "not available for recognize" → unsupported recording (too short, etc.)
//   - "error"                 → vendor-side failure
export type SpeechRecognitionStatus =
  | 'recognized'
  | 'in_progress'
  | 'ready_for_recognize'
  | 'not_available'
  | 'error'
  | 'unknown';

export type ZadarmaSpeechResponse = {
  status?: 'success' | 'error';
  recognitionStatus?: string;
  words?: unknown;
  message?: string;
};

export type ParseTranscriptResult = {
  status: SpeechRecognitionStatus;
  turns: DialogTurn[] | null;
  error: string | null;
};

const normaliseStatus = (raw: string | undefined): SpeechRecognitionStatus => {
  if (!raw) return 'unknown';
  const v = raw.toLowerCase().trim();
  if (v === 'recognized') return 'recognized';
  if (v === 'in progress') return 'in_progress';
  if (v === 'ready for recognize') return 'ready_for_recognize';
  if (v === 'not available for recognize') return 'not_available';
  if (v === 'error') return 'error';
  return 'unknown';
};

export const parseTranscriptResponse = (
  data: unknown,
): ParseTranscriptResult => {
  if (!data || typeof data !== 'object') {
    return { status: 'error', turns: null, error: 'invalid response' };
  }
  const r = data as ZadarmaSpeechResponse;
  if (r.status === 'error') {
    return { status: 'error', turns: null, error: r.message ?? 'API error' };
  }
  const recognitionStatus = normaliseStatus(r.recognitionStatus);
  if (recognitionStatus !== 'recognized') {
    return { status: recognitionStatus, turns: null, error: null };
  }
  const turns = extractDialogTurns({ words: r.words });
  if (!turns || turns.length === 0) {
    return {
      status: 'recognized',
      turns: null,
      error: 'recognized but empty turns',
    };
  }
  return { status: 'recognized', turns, error: null };
};

export type FetchTranscriptArgs = {
  callId: string;
  userKey: string;
  secret: string;
};

export const fetchCallTranscript = async ({
  callId,
  userKey,
  secret,
}: FetchTranscriptArgs): Promise<ParseTranscriptResult> => {
  if (!callId) {
    return { status: 'error', turns: null, error: 'callId missing' };
  }
  const signed = signZadarmaRequest({
    method: '/v1/speech_recognition/',
    params: { call_id: callId, return: 'words' },
    userKey,
    secret,
    httpMethod: 'GET',
  });
  let response: Response;
  try {
    response = await fetch(signed.url, { method: 'GET', headers: signed.headers });
  } catch (err) {
    return {
      status: 'error',
      turns: null,
      error: err instanceof Error ? err.message : 'fetch failed',
    };
  }
  if (response.status === 429) {
    return { status: 'error', turns: null, error: 'rate-limited (429)' };
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return {
      status: 'error',
      turns: null,
      error: `non-JSON response (HTTP ${response.status})`,
    };
  }
  return parseTranscriptResponse(json);
};
