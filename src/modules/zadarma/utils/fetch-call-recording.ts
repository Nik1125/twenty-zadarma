import { signZadarmaRequest } from 'src/modules/zadarma/connector/sign-request';

// Wraps `GET /v1/pbx/record/request/?...&lifetime=5184000` for sync /
// backfill enrichment. The endpoint accepts either `call_id` (Asterisk
// channel id) or `pbx_call_id`; we use `pbx_call_id` because every callLog
// row has it (legacy rows synced before v0.17.0 do not have `callId`).
//
// Per Zadarma docs: passing pbx_call_id can return multiple links if
// several recordings exist for the same PBX call (rare — usually only when
// a multi-leg call recorded each leg). We pick the first.
//
// Lifetime 5184000 = 60 days (Zadarma maximum). Default of 1800 (30 min)
// caused the previously stored URLs to 404 within an hour.
const LIFETIME_SECONDS = 5_184_000;

export type ZadarmaRecordResponse = {
  status?: 'success' | 'error';
  link?: string;
  links?: string[];
  message?: string;
};

export type ParseRecordingResult = {
  link: string | null;
  error: string | null;
};

export const parseRecordingResponse = (
  data: unknown,
): ParseRecordingResult => {
  if (!data || typeof data !== 'object') {
    return { link: null, error: 'invalid response' };
  }
  const r = data as ZadarmaRecordResponse;
  if (r.status !== 'success') {
    return { link: null, error: r.message ?? `status=${r.status ?? 'unknown'}` };
  }
  const link = r.link ?? r.links?.[0] ?? null;
  if (!link) return { link: null, error: 'no link in response' };
  return { link, error: null };
};

export type FetchRecordingArgs = {
  pbxCallId: string;
  userKey: string;
  secret: string;
};

export const fetchCallRecordingLink = async ({
  pbxCallId,
  userKey,
  secret,
}: FetchRecordingArgs): Promise<ParseRecordingResult> => {
  if (!pbxCallId) return { link: null, error: 'pbxCallId missing' };
  const signed = signZadarmaRequest({
    method: '/v1/pbx/record/request/',
    params: { pbx_call_id: pbxCallId, lifetime: LIFETIME_SECONDS },
    userKey,
    secret,
    httpMethod: 'GET',
  });
  let response: Response;
  try {
    response = await fetch(signed.url, { method: 'GET', headers: signed.headers });
  } catch (err) {
    return { link: null, error: err instanceof Error ? err.message : 'fetch failed' };
  }
  if (response.status === 429) {
    return { link: null, error: 'rate-limited (429)' };
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { link: null, error: `non-JSON response (HTTP ${response.status})` };
  }
  return parseRecordingResponse(json);
};
