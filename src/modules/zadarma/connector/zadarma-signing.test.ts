import { describe, expect, it } from 'vitest';

import { buildZadarmaSignature, signZadarmaRequest } from './sign-request';
import { getRawBodyForSignature, verifyZadarmaWebhook } from './verify-webhook';

const USER_KEY = 'ae76aa6cd58bc477eec9';
const SECRET = '6f6ebd6dff4157498150';

describe('buildZadarmaSignature', () => {
  // Reference values produced by the official PHP client / N8N JS:
  // method='/v1/info/balance/', no params → md5 of empty string is d41d8cd98f00b204e9800998ecf8427e.
  // signString = '/v1/info/balance/d41d8cd98f00b204e9800998ecf8427e'.
  // hmac-sha1 hex → base64 of that hex string is what Zadarma expects.
  it('produces deterministic hex→base64-wrapped signature', () => {
    const sig = buildZadarmaSignature(
      '/v1/info/balance/d41d8cd98f00b204e9800998ecf8427e',
      SECRET,
    );
    // Confirm shape: base64-encoded UTF-8 bytes of a 40-char hex string ⇒ 56 chars.
    expect(sig).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(sig.length).toBe(56);
  });

  it('different secrets produce different signatures', () => {
    const a = buildZadarmaSignature('/v1/info/balance/abc', SECRET);
    const b = buildZadarmaSignature('/v1/info/balance/abc', 'other-secret');
    expect(a).not.toBe(b);
  });
});

describe('signZadarmaRequest → verifyZadarmaWebhook round-trip', () => {
  it('a request signed for a path verifies against that same path', () => {
    const path = '/zadarma/webhook';
    const params = {
      event: 'NOTIFY_END',
      pbx_call_id: 'in_abc123',
      caller_id: '48792010388',
      called_did: '48573580808',
      disposition: 'answered',
      duration: '42',
    };

    const signed = signZadarmaRequest({
      method: path,
      params,
      userKey: USER_KEY,
      secret: SECRET,
    });

    const result = verifyZadarmaWebhook({
      path,
      rawBody: signed.body ?? null,
      authHeader: signed.headers.Authorization,
      secret: SECRET,
    });

    expect(result).toEqual({ ok: true });
  });

  it('rejects when raw body was tampered after signing', () => {
    const path = '/zadarma/webhook';
    const signed = signZadarmaRequest({
      method: path,
      params: { event: 'NOTIFY_END', duration: '5' },
      userKey: USER_KEY,
      secret: SECRET,
    });
    const tampered = (signed.body ?? '').replace('5', '999');

    const result = verifyZadarmaWebhook({
      path,
      rawBody: tampered,
      authHeader: signed.headers.Authorization,
      secret: SECRET,
    });

    expect(result.ok).toBe(false);
  });

  it('rejects when secret differs', () => {
    const path = '/zadarma/webhook';
    const signed = signZadarmaRequest({
      method: path,
      params: { event: 'NOTIFY_START' },
      userKey: USER_KEY,
      secret: SECRET,
    });

    const result = verifyZadarmaWebhook({
      path,
      rawBody: signed.body ?? null,
      authHeader: signed.headers.Authorization,
      secret: 'wrong-secret',
    });

    expect(result.ok).toBe(false);
  });

  it('rejects when path differs from the one used at signing', () => {
    const params = { event: 'NOTIFY_END' };
    const signed = signZadarmaRequest({
      method: '/zadarma/webhook',
      params,
      userKey: USER_KEY,
      secret: SECRET,
    });

    const result = verifyZadarmaWebhook({
      path: '/v1/different/',
      rawBody: signed.body ?? null,
      authHeader: signed.headers.Authorization,
      secret: SECRET,
    });

    expect(result.ok).toBe(false);
  });

  it('rejects missing Authorization header', () => {
    const result = verifyZadarmaWebhook({
      path: '/zadarma/webhook',
      rawBody: 'event=NOTIFY_END',
      authHeader: undefined,
      secret: SECRET,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: 'missing Authorization header',
    });
  });

  it('rejects malformed Authorization header (no colon)', () => {
    const result = verifyZadarmaWebhook({
      path: '/zadarma/webhook',
      rawBody: 'event=NOTIFY_END',
      authHeader: 'just-some-string',
      secret: SECRET,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: 'malformed Authorization header (no colon)',
    });
  });

  it('rejects empty signature in Authorization header', () => {
    const result = verifyZadarmaWebhook({
      path: '/zadarma/webhook',
      rawBody: 'event=NOTIFY_END',
      authHeader: `${USER_KEY}:`,
      secret: SECRET,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: 'empty signature in Authorization header',
    });
  });

  it('rejects when signature length differs', () => {
    const result = verifyZadarmaWebhook({
      path: '/zadarma/webhook',
      rawBody: 'event=NOTIFY_END',
      authHeader: `${USER_KEY}:tooshort`,
      secret: SECRET,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: 'signature length mismatch',
    });
  });
});

describe('getRawBodyForSignature', () => {
  it('prefers event.rawBody when the runtime forwarded it', () => {
    expect(
      getRawBodyForSignature({
        body: { event: 'NOTIFY_END' },
        rawBody: 'event=NOTIFY_END&duration=5',
      }),
    ).toBe('event=NOTIFY_END&duration=5');
  });

  it('falls back to string body when rawBody is not provided', () => {
    expect(
      getRawBodyForSignature({ body: 'event=NOTIFY_END', isBase64Encoded: false }),
    ).toBe('event=NOTIFY_END');
  });

  it('decodes base64 body when isBase64Encoded is true', () => {
    const original = 'event=NOTIFY_END&duration=5';
    const b64 = Buffer.from(original, 'utf8').toString('base64');
    expect(getRawBodyForSignature({ body: b64, isBase64Encoded: true })).toBe(original);
  });

  it('returns null when body is a parsed object and rawBody missing (raw bytes lost)', () => {
    expect(getRawBodyForSignature({ body: { event: 'NOTIFY_END' } })).toBeNull();
  });

  it('returns empty string for null body', () => {
    expect(getRawBodyForSignature({ body: null })).toBe('');
  });
});

describe('phpEncode parity (RFC 1738 with !\'()* escaped)', () => {
  it('signature for params with special chars is stable', () => {
    // These chars matter because URLSearchParams alone leaves * unescaped,
    // while PHP's http_build_query escapes !'()* — Zadarma's reference signer
    // uses the PHP form, so verify must match it.
    const path = '/zadarma/webhook';
    const params = {
      message: "Hi! It's a (test) *call*",
      number: '48573580808',
    };

    const signed = signZadarmaRequest({
      method: path,
      params,
      userKey: USER_KEY,
      secret: SECRET,
    });

    expect(
      verifyZadarmaWebhook({
        path,
        rawBody: signed.body ?? null,
        authHeader: signed.headers.Authorization,
        secret: SECRET,
      }),
    ).toEqual({ ok: true });
  });
});
