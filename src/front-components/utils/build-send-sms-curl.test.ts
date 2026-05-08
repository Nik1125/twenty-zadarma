import { describe, expect, it } from 'vitest';

import { buildSendSmsCurl } from 'src/front-components/utils/build-send-sms-curl';

describe('buildSendSmsCurl', () => {
  const URL = 'https://twenty.example/s/zadarma/send-sms';

  it('embeds the supplied endpoint URL', () => {
    expect(buildSendSmsCurl(URL)).toContain(URL);
  });

  it('uses POST', () => {
    expect(buildSendSmsCurl(URL)).toContain('curl -X POST');
  });

  it('emits Authorization Bearer placeholder', () => {
    expect(buildSendSmsCurl(URL)).toContain(
      "Authorization: Bearer YOUR_WORKSPACE_API_KEY",
    );
  });

  it('emits Content-Type application/json', () => {
    expect(buildSendSmsCurl(URL)).toContain(
      "'Content-Type: application/json'",
    );
  });

  it('lists all four analytics tag fields in the body', () => {
    const out = buildSendSmsCurl(URL);
    expect(out).toContain('"category"');
    expect(out).toContain('"source"');
    expect(out).toContain('"templateName"');
    expect(out).toContain('"campaignId"');
  });

  it('shows realistic example enum values for category/source', () => {
    const out = buildSendSmsCurl(URL);
    expect(out).toContain('"category":"REMINDER"');
    expect(out).toContain('"source":"N8N"');
  });
});
