import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  composeTeamSaleUrl,
  createLead,
  lookupLeadByPhone,
  TeamSaleApiError,
  TeamSaleRateLimitError,
} from './teamsale-api';

const CREDS = { userKey: 'k', secret: 's' };

const mockFetch = (
  status: number,
  bodyJson: unknown,
  retryAfter?: string,
): Response => {
  const headers = new Headers();
  if (retryAfter) headers.set('retry-after', retryAfter);
  return new Response(JSON.stringify(bodyJson), {
    status,
    headers,
  });
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('composeTeamSaleUrl', () => {
  it('joins baseUrl + /leads/<id>', () => {
    expect(composeTeamSaleUrl('https://x.teamsale.com', '42')).toBe(
      'https://x.teamsale.com/leads/42',
    );
  });

  it('strips trailing slash from baseUrl', () => {
    expect(composeTeamSaleUrl('https://x.teamsale.com/', '42')).toBe(
      'https://x.teamsale.com/leads/42',
    );
    expect(composeTeamSaleUrl('https://x.teamsale.com///', '42')).toBe(
      'https://x.teamsale.com/leads/42',
    );
  });
});

describe('lookupLeadByPhone', () => {
  it('returns id from real { status, data: { leads: [...] } } envelope when phone matches', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetch(200, {
        status: 'success',
        data: {
          leads: [
            {
              id: '80165732',
              name: 'Jowita Karkut',
              phones: [{ id: '1', phone: '+48539923725', type: 'personal' }],
            },
          ],
          totalCount: 1,
        },
      }),
    );
    expect(await lookupLeadByPhone('+48539923725', CREDS)).toBe('80165732');
  });

  it('returns null when search fuzzy-matches a lead whose phones do not contain the exact target', async () => {
    // Real risk: ?search=+48539 may return leads matching "539" in name/comment,
    // not by phone. We must not silently link Person to the wrong lead.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetch(200, {
        status: 'success',
        data: {
          leads: [
            {
              id: '99999',
              name: 'Unrelated 539',
              phones: [{ phone: '+48999999999' }],
            },
          ],
          totalCount: 1,
        },
      }),
    );
    expect(await lookupLeadByPhone('+48539923725', CREDS)).toBeNull();
  });

  it('returns the lead whose phones include the exact target when multiple leads come back', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetch(200, {
        status: 'success',
        data: {
          leads: [
            { id: '111', phones: [{ phone: '+48999111111' }] },
            { id: '222', phones: [{ phone: '+48539923725' }] },
            { id: '333', phones: [{ phone: '+48999333333' }] },
          ],
          totalCount: 3,
        },
      }),
    );
    expect(await lookupLeadByPhone('+48539923725', CREDS)).toBe('222');
  });

  it('signs request with search=<phone>, not phone=<phone>', async () => {
    let capturedUrl: string | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      capturedUrl = String(url);
      return mockFetch(200, { status: 'success', data: { leads: [], totalCount: 0 } });
    });
    await lookupLeadByPhone('+48539923725', CREDS);
    expect(capturedUrl).toContain('search=%2B48539923725');
    expect(capturedUrl).not.toContain('phone=');
  });

  it('returns id from legacy flat { leads: [{ id }] } envelope (no phones field)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetch(200, { leads: [{ id: 80389317 }] }),
    );
    const id = await lookupLeadByPhone('+48111222333', CREDS);
    expect(id).toBe('80389317');
  });

  it('returns id from legacy flat { data: [{ id }] } envelope (no phones field)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetch(200, { data: [{ id: 'abc-1' }] }),
    );
    expect(await lookupLeadByPhone('+48...', CREDS)).toBe('abc-1');
  });

  it('returns null on empty list', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetch(200, { status: 'success', data: { leads: [], totalCount: 0 } }),
    );
    expect(await lookupLeadByPhone('+48...', CREDS)).toBeNull();
  });

  it('returns null when status="error" (no leads)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetch(200, { status: 'error', message: 'no leads' }),
    );
    expect(await lookupLeadByPhone('+48...', CREDS)).toBeNull();
  });

  it('throws TeamSaleRateLimitError on HTTP 429 with retry-after', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetch(429, { error: 'rate limit' }, '12'),
    );
    await expect(lookupLeadByPhone('+48...', CREDS)).rejects.toBeInstanceOf(
      TeamSaleRateLimitError,
    );
  });

  it('throws TeamSaleApiError on HTTP 500', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetch(500, { error: 'server error' }),
    );
    await expect(lookupLeadByPhone('+48...', CREDS)).rejects.toBeInstanceOf(
      TeamSaleApiError,
    );
  });
});

describe('createLead', () => {
  it('returns id from { lead: { id } } envelope', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetch(200, { status: 'success', lead: { id: 999 } }),
    );
    const id = await createLead(
      { name: 'Anna', phone: '+48579872402', leadSource: 'inbound_call' },
      CREDS,
    );
    expect(id).toBe('999');
  });

  it('returns id from flat { id } envelope', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetch(200, { id: 1234 }),
    );
    const id = await createLead({ name: 'X', phone: '+48...' }, CREDS);
    expect(id).toBe('1234');
  });

  it('throws TeamSaleApiError when no id present', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetch(200, { status: 'success', message: 'no id returned' }),
    );
    await expect(
      createLead({ name: 'X', phone: '+48...' }, CREDS),
    ).rejects.toBeInstanceOf(TeamSaleApiError);
  });

  it('throws TeamSaleRateLimitError on 429', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetch(429, {}, '60'),
    );
    await expect(
      createLead({ name: 'X', phone: '+48...' }, CREDS),
    ).rejects.toBeInstanceOf(TeamSaleRateLimitError);
  });

  it('signs request body with bracket-notation params', async () => {
    let capturedBody: string | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      capturedBody = init?.body as string | undefined;
      return mockFetch(200, { id: 1 });
    });
    await createLead(
      {
        name: 'Anna Kowalska',
        phone: '+48579872402',
        leadSource: 'inbound_call',
        comment: 'test',
      },
      CREDS,
    );
    expect(capturedBody).toContain('lead%5Bname%5D=Anna+Kowalska');
    expect(capturedBody).toContain('lead%5Bphones%5D%5B0%5D%5Bphone%5D=%2B48579872402');
    expect(capturedBody).toContain('lead%5Bphones%5D%5B0%5D%5Btype%5D=work');
    expect(capturedBody).toContain('lead%5Blead_source%5D=inbound_call');
    expect(capturedBody).toContain('lead%5Bcomment%5D=test');
  });

  it('defaults leadSource to "form" when not specified', async () => {
    let capturedBody: string | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      capturedBody = init?.body as string | undefined;
      return mockFetch(200, { id: 1 });
    });
    await createLead({ name: 'X', phone: '+48...' }, CREDS);
    expect(capturedBody).toContain('lead%5Blead_source%5D=form');
  });
});
