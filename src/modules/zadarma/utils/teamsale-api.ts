import { signZadarmaRequest } from 'src/modules/zadarma/connector/sign-request';

// Thin wrappers over Zadarma's TeamSale-CRM (formerly ZCRM) API used by
// sync-person-to-teamsale + teamsale-backfill. Two operations:
//
//   - lookupLeadByPhone(phone) — GET /v1/zcrm/leads?phone=...; returns
//     existing lead id when one matches the supplied phone (E.164 with
//     leading "+"). Returns null on no-match. Throws RateLimitError on
//     HTTP 429 so the caller can back off.
//
//   - createLead({ name, phone, leadSource?, comment? }) — POST
//     /v1/zcrm/leads with the bracket-notation lead[name] / lead[phones]
//     / etc. body. Returns the new lead id.
//
// Response-shape note: Zadarma's TeamSale API is sparsely documented.
// Both endpoints accept the standard ZADARMA_USER_KEY + ZADARMA_SECRET
// pair (signed via the same scheme as /v1/sms/send/), but the response
// envelope varies slightly across endpoints. The helpers below probe
// multiple shapes so a minor backend tweak doesn't silently break them.

export type CreateLeadInput = {
  name: string;
  phone: string; // E.164 with "+"
  leadSource?: string; // e.g. "form", "inbound_call"; defaults to "form"
  comment?: string;
};

export type TeamSaleApiCreds = {
  userKey: string;
  secret: string;
};

export class TeamSaleApiError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'TeamSaleApiError';
    this.status = status;
    this.body = body;
  }
}

export class TeamSaleRateLimitError extends TeamSaleApiError {
  retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, body: string) {
    super(`Zadarma rate limit hit; retry after ${retryAfterSeconds}s`, 429, body);
    this.name = 'TeamSaleRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const ENDPOINT_LEADS = '/v1/zcrm/leads/';

const parseRetryAfter = (h: Headers): number => {
  const v = h.get('retry-after');
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 30;
};

// Picks an `id` out of common Zadarma JSON envelopes. Real responses
// observed in the wild come back as `{ lead: { id } }` or
// `{ data: { id } }` or just `{ id }`; we try each.
const pickLeadId = (raw: unknown): string | null => {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const candidates: unknown[] = [
    obj.id,
    (obj.lead as Record<string, unknown> | undefined)?.id,
    (obj.data as Record<string, unknown> | undefined)?.id,
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return String(c);
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
};

const pickLeadIdFromList = (raw: unknown): string | null => {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const lists: unknown[] = [obj.leads, obj.data, obj.list];
  for (const list of lists) {
    if (Array.isArray(list) && list.length > 0) {
      const id = pickLeadId(list[0]);
      if (id) return id;
    }
  }
  // Some endpoints return a single object on .lead even for list calls.
  return pickLeadId(raw);
};

export const lookupLeadByPhone = async (
  phone: string,
  creds: TeamSaleApiCreds,
): Promise<string | null> => {
  const { url, headers } = signZadarmaRequest({
    method: ENDPOINT_LEADS,
    params: { phone },
    userKey: creds.userKey,
    secret: creds.secret,
    httpMethod: 'GET',
  });
  const res = await fetch(url, { method: 'GET', headers });
  const body = await res.text();
  if (res.status === 429) {
    throw new TeamSaleRateLimitError(parseRetryAfter(res.headers), body);
  }
  if (!res.ok) {
    throw new TeamSaleApiError(
      `lookupLeadByPhone failed (HTTP ${res.status})`,
      res.status,
      body,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new TeamSaleApiError(
      'lookupLeadByPhone: response was not JSON',
      res.status,
      body,
    );
  }
  // Defensive: if status="error" + a message about "no leads", return null.
  const j = json as Record<string, unknown>;
  if (j.status === 'error') {
    return null;
  }
  return pickLeadIdFromList(json);
};

export const createLead = async (
  input: CreateLeadInput,
  creds: TeamSaleApiCreds,
): Promise<string> => {
  // Bracket-notation params per Zadarma docs / lead-form example.
  // signZadarmaRequest preserves the exact key strings (sorted) and
  // RFC 1738-encodes them, which is what the signature expects.
  const params: Record<string, string> = {
    'lead[name]': input.name,
    'lead[phones][0][phone]': input.phone,
    'lead[phones][0][type]': 'work',
    'lead[lead_source]': input.leadSource ?? 'form',
  };
  if (input.comment && input.comment.trim().length > 0) {
    params['lead[comment]'] = input.comment.trim();
  }

  const { url, headers, body: signedBody } = signZadarmaRequest({
    method: ENDPOINT_LEADS,
    params,
    userKey: creds.userKey,
    secret: creds.secret,
    httpMethod: 'POST',
  });
  const res = await fetch(url, { method: 'POST', headers, body: signedBody });
  const body = await res.text();
  if (res.status === 429) {
    throw new TeamSaleRateLimitError(parseRetryAfter(res.headers), body);
  }
  if (!res.ok) {
    throw new TeamSaleApiError(
      `createLead failed (HTTP ${res.status})`,
      res.status,
      body,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new TeamSaleApiError(
      'createLead: response was not JSON',
      res.status,
      body,
    );
  }
  const id = pickLeadId(json) ?? pickLeadIdFromList(json);
  if (!id) {
    throw new TeamSaleApiError(
      'createLead: no lead id in response',
      res.status,
      body,
    );
  }
  return id;
};

// Composes the final TeamSale URL stored on Person.teamSaleLink.
// `baseUrl` is the user-configured `TEAMSALE_BASE_URL` applicationVariable
// (e.g. "https://yourco.teamsale.com"). Trailing slash is tolerated.
export const composeTeamSaleUrl = (
  baseUrl: string,
  leadId: string,
): string => {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return `${trimmed}/leads/${leadId}`;
};
