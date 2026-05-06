import { createHash, createHmac } from 'node:crypto';

type ZadarmaPrimitive = string | number | boolean;

export type SignZadarmaRequestArgs = {
  method: string;
  params: Record<string, ZadarmaPrimitive | undefined>;
  userKey: string;
  secret: string;
  baseUrl?: string;
  httpMethod?: 'GET' | 'POST';
};

export type SignedZadarmaRequest = {
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
};

// PHP urlencode-compatible: matches http_build_query($params, null, '&', PHP_QUERY_RFC1738)
// which is what Zadarma's reference client uses. encodeURIComponent leaves !'()* alone,
// so we add explicit replacements for them. Spaces become + (RFC 1738), not %20.
const phpEncode = (s: string): string =>
  encodeURIComponent(s)
    .replace(/%20/g, '+')
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');

const buildParamsStr = (params: Record<string, ZadarmaPrimitive | undefined>): string => {
  const entries = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.map(([k, v]) => `${phpEncode(k)}=${phpEncode(v)}`).join('&');
};

// Zadarma signs as: hex(hmac_sha1(secret, signString)) → utf8 bytes of that hex string → base64.
// Not the more common binary-hmac → base64. This matches the reference PHP client exactly.
export const buildZadarmaSignature = (
  signString: string,
  secret: string,
): string => {
  const hmacHex = createHmac('sha1', secret).update(signString).digest('hex');
  return Buffer.from(hmacHex, 'utf8').toString('base64');
};

export const signZadarmaRequest = ({
  method,
  params,
  userKey,
  secret,
  baseUrl = 'https://api.zadarma.com',
  httpMethod = 'POST',
}: SignZadarmaRequestArgs): SignedZadarmaRequest => {
  const paramsStr = buildParamsStr(params);
  const md5Hex = createHash('md5').update(paramsStr).digest('hex');
  const signature = buildZadarmaSignature(method + paramsStr + md5Hex, secret);

  const headers: Record<string, string> = {
    Authorization: `${userKey}:${signature}`,
  };

  if (httpMethod === 'GET') {
    const url = paramsStr.length > 0 ? `${baseUrl}${method}?${paramsStr}` : `${baseUrl}${method}`;
    return { url, headers, body: undefined };
  }

  headers['Content-Type'] = 'application/x-www-form-urlencoded';
  return { url: `${baseUrl}${method}`, headers, body: paramsStr };
};
