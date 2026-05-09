import { describe, it, expect } from 'vitest';

import { parseRecordingResponse } from 'src/modules/zadarma/utils/fetch-call-recording';

describe('parseRecordingResponse', () => {
  it('returns link from `link` field on success', () => {
    expect(
      parseRecordingResponse({
        status: 'success',
        link: 'https://example.com/rec.mp3',
      }),
    ).toEqual({ link: 'https://example.com/rec.mp3', error: null });
  });

  it('falls back to first entry of `links[]` when `link` missing', () => {
    expect(
      parseRecordingResponse({
        status: 'success',
        links: ['https://example.com/a.mp3', 'https://example.com/b.mp3'],
      }),
    ).toEqual({ link: 'https://example.com/a.mp3', error: null });
  });

  it('returns error when status is error', () => {
    const r = parseRecordingResponse({
      status: 'error',
      message: 'Recording not found',
    });
    expect(r.link).toBeNull();
    expect(r.error).toBe('Recording not found');
  });

  it('returns error when status field is missing entirely', () => {
    const r = parseRecordingResponse({ link: 'https://example.com/rec.mp3' });
    expect(r.link).toBeNull();
    expect(r.error).toContain('status=');
  });

  it('returns error when response is not an object', () => {
    expect(parseRecordingResponse(null)).toEqual({
      link: null,
      error: 'invalid response',
    });
    expect(parseRecordingResponse('plain text')).toEqual({
      link: null,
      error: 'invalid response',
    });
  });

  it('returns error when status=success but no link present', () => {
    const r = parseRecordingResponse({ status: 'success' });
    expect(r.link).toBeNull();
    expect(r.error).toBe('no link in response');
  });
});
