import { describe, expect, it } from 'vitest';

import { buildEnrichmentCurl } from './build-enrichment-curl';

describe('buildEnrichmentCurl', () => {
  const URL = 'https://example.com/s/zadarma/call-enrichment';

  it('starts with a POST and the supplied URL single-quoted', () => {
    const out = buildEnrichmentCurl(URL);
    expect(out).toContain(`curl -X POST '${URL}'`);
  });

  it('includes Authorization Bearer placeholder header', () => {
    const out = buildEnrichmentCurl(URL);
    expect(out).toContain("-H 'Authorization: Bearer YOUR_WORKSPACE_API_KEY'");
  });

  it('includes Content-Type application/json header', () => {
    const out = buildEnrichmentCurl(URL);
    expect(out).toContain("-H 'Content-Type: application/json'");
  });

  it('embeds JSON body with match + data fields and placeholders', () => {
    const out = buildEnrichmentCurl(URL);
    const dataMatch = out.match(/-d '(\{.*\})'$/);
    expect(dataMatch).not.toBeNull();
    const body = JSON.parse(dataMatch![1]);
    expect(body.match).toMatchObject({
      correlationId: '<call_id>',
      fromNumber: '<from_number>',
      toNumber: '<to_number>',
      startTimestamp: '<start_timestamp_ms>',
    });
    expect(body.data).toMatchObject({
      aiVendor: 'retell',
      aiTransferred: false,
      aiCost: { amountMicros: 0, currencyCode: 'USD' },
      // Universal (no ai prefix as of v0.25).
      sentiment: 'NEUTRAL',
      successful: true,
      interestLevel: 4,
      actionRequired: 'OPERATOR_TASK',
      keyTopics: ['<topic_1>', 'objection:<reason>'],
      // NEW v0.25 fields.
      outcome: 'FOLLOWUP',
      score: 4,
    });
    // Legacy `ai*` keys should NOT appear — the helper steers users to the
    // canonical form. The webhook still accepts them for back-compat.
    expect(body.data).not.toHaveProperty('aiSentiment');
    expect(body.data).not.toHaveProperty('aiSuccessful');
    expect(body.data).not.toHaveProperty('aiInterestLevel');
    expect(body.data).not.toHaveProperty('aiActionRequired');
    expect(body.data).not.toHaveProperty('aiKeyTopics');
  });

  it('produces output that does not contain any double-single-quote pair (safe paste)', () => {
    const out = buildEnrichmentCurl(URL);
    // The single-quote-wrapped `-d 'JSON'` pattern only works because
    // JSON.stringify never emits unescaped single quotes inside strings.
    expect(out).not.toMatch(/[^\\]''/);
  });
});
