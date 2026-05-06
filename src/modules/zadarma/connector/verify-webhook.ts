import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type SignatureVerificationResult =
  | { ok: true }
  | { ok: false; reason: string };

export const getRawBodyForSignature = (event: {
  body: unknown;
  isBase64Encoded?: boolean;
  rawBody?: string;
}): string | null => {
  if (typeof event.rawBody === 'string') return event.rawBody;
  const raw = event.body;
  if (raw == null) return '';
  if (typeof raw === 'string') {
    return event.isBase64Encoded
      ? Buffer.from(raw, 'base64').toString('utf8')
      : raw;
  }
  return null;
};

// PHP urlencode-compatible — must match the encoding sign-request.ts uses,
// otherwise round-trip verification breaks on !'()* characters.
const phpEncode = (s: string): string =>
  encodeURIComponent(s)
    .replace(/%20/g, '+')
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');

// Re-canonicalise the body: parse, drop nulls, sort by key, rebuild with phpEncode.
// Zadarma's signature is computed over a sorted/encoded form of the params, so we
// can't trust whatever order/encoding the raw body arrived in.
const canonicalizeParamsString = (rawBody: string): string => {
  const parsed = new URLSearchParams(rawBody);
  const entries: Array<[string, string]> = [];
  for (const [key, value] of parsed.entries()) entries.push([key, value]);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.map(([k, v]) => `${phpEncode(k)}=${phpEncode(v)}`).join('&');
};

type VerifyArgs = {
  path: string;
  rawBody: string | null;
  authHeader: string | undefined;
  secret: string;
};

export const verifyZadarmaWebhook = ({
  path,
  rawBody,
  authHeader,
  secret,
}: VerifyArgs): SignatureVerificationResult => {
  if (rawBody === null) {
    return {
      ok: false,
      reason: 'raw request body is unavailable; HMAC cannot be verified',
    };
  }
  if (!authHeader) {
    return { ok: false, reason: 'missing Authorization header' };
  }
  const colonIdx = authHeader.indexOf(':');
  if (colonIdx === -1) {
    return { ok: false, reason: 'malformed Authorization header (no colon)' };
  }
  const provided = authHeader.slice(colonIdx + 1).trim();
  if (provided.length === 0) {
    return { ok: false, reason: 'empty signature in Authorization header' };
  }

  const paramsStr = canonicalizeParamsString(rawBody);
  const md5Hex = createHash('md5').update(paramsStr).digest('hex');
  // Same hex → utf8 bytes → base64 wrapping as the outgoing signer
  const hmacHex = createHmac('sha1', secret)
    .update(path + paramsStr + md5Hex)
    .digest('hex');
  const expected = Buffer.from(hmacHex, 'utf8').toString('base64');

  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) {
    return { ok: false, reason: 'signature length mismatch' };
  }
  return timingSafeEqual(a, b)
    ? { ok: true }
    : { ok: false, reason: 'signature mismatch' };
};
