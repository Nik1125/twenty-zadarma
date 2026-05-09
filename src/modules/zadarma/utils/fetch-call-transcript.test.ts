import { describe, it, expect } from 'vitest';

import { parseTranscriptResponse } from 'src/modules/zadarma/utils/fetch-call-transcript';

describe('parseTranscriptResponse', () => {
  it('returns turns when recognitionStatus is recognized', () => {
    const r = parseTranscriptResponse({
      status: 'success',
      recognitionStatus: 'recognized',
      words: [
        { channel: 1, result: [{ s: 0, w: 'Hello' }] },
        { channel: 2, result: [{ s: 1, w: 'Hi' }] },
      ],
    });
    expect(r.status).toBe('recognized');
    expect(r.error).toBeNull();
    expect(r.turns).toEqual([
      { channel: 1, text: 'Hello' },
      { channel: 2, text: 'Hi' },
    ]);
  });

  it('returns in_progress when recognition is still running', () => {
    const r = parseTranscriptResponse({
      status: 'success',
      recognitionStatus: 'in progress',
    });
    expect(r.status).toBe('in_progress');
    expect(r.turns).toBeNull();
    expect(r.error).toBeNull();
  });

  it('returns ready_for_recognize when manual init required (paid feature, we skip)', () => {
    const r = parseTranscriptResponse({
      status: 'success',
      recognitionStatus: 'ready for recognize',
    });
    expect(r.status).toBe('ready_for_recognize');
    expect(r.turns).toBeNull();
  });

  it('returns not_available for unsupported recordings', () => {
    const r = parseTranscriptResponse({
      status: 'success',
      recognitionStatus: 'not available for recognize',
    });
    expect(r.status).toBe('not_available');
    expect(r.turns).toBeNull();
  });

  it('returns error when API returns status=error', () => {
    const r = parseTranscriptResponse({
      status: 'error',
      message: 'Call not found',
    });
    expect(r.status).toBe('error');
    expect(r.error).toBe('Call not found');
    expect(r.turns).toBeNull();
  });

  it('returns error when response is not an object', () => {
    expect(parseTranscriptResponse(null)).toMatchObject({
      status: 'error',
      turns: null,
    });
    expect(parseTranscriptResponse('plain text')).toMatchObject({
      status: 'error',
      turns: null,
    });
  });

  it('returns recognized with empty-turns error when words[] is populated but parses to nothing', () => {
    const r = parseTranscriptResponse({
      status: 'success',
      recognitionStatus: 'recognized',
      words: [{ channel: 1, result: [] }],
    });
    expect(r.status).toBe('recognized');
    expect(r.turns).toBeNull();
    expect(r.error).toBe('recognized but empty turns');
  });

  it('treats unknown recognitionStatus as `unknown`', () => {
    const r = parseTranscriptResponse({
      status: 'success',
      recognitionStatus: 'something_new',
    });
    expect(r.status).toBe('unknown');
    expect(r.turns).toBeNull();
  });
});
