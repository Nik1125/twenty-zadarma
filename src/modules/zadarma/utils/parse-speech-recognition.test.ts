import { describe, it, expect } from 'vitest';

import { extractDialogTurns } from 'src/modules/zadarma/utils/parse-speech-recognition';

describe('extractDialogTurns', () => {
  it('returns null for empty / malformed input', () => {
    expect(extractDialogTurns(null)).toBeNull();
    expect(extractDialogTurns(undefined)).toBeNull();
    expect(extractDialogTurns('')).toBeNull();
    expect(extractDialogTurns('not-json')).toBeNull();
    expect(extractDialogTurns({})).toBeNull();
    expect(extractDialogTurns({ words: [] })).toBeNull();
  });

  it('parses a JSON string (webhook shape) into turns', () => {
    const rawResult = JSON.stringify({
      words: [
        {
          channel: 1,
          result: [
            { s: 0.5, e: 1.0, w: 'Hello' },
            { s: 1.0, e: 1.4, w: 'there' },
          ],
        },
        {
          channel: 2,
          result: [
            { s: 1.6, e: 2.2, w: 'Hi' },
          ],
        },
      ],
    });
    const turns = extractDialogTurns(rawResult);
    expect(turns).toEqual([
      { channel: 1, text: 'Hello there' },
      { channel: 2, text: 'Hi' },
    ]);
  });

  it('parses a parsed object (polling shape) into turns', () => {
    const obj = {
      words: [
        {
          channel: 1,
          result: [{ s: 0, e: 1, w: 'Test' }],
        },
      ],
    };
    expect(extractDialogTurns(obj)).toEqual([{ channel: 1, text: 'Test' }]);
  });

  it('time-orders segments before merging', () => {
    const obj = {
      words: [
        { channel: 1, result: [{ s: 5.0, w: 'second' }] },
        { channel: 1, result: [{ s: 1.0, w: 'first' }] },
      ],
    };
    expect(extractDialogTurns(obj)).toEqual([
      { channel: 1, text: 'first second' },
    ]);
  });

  it('merges consecutive same-channel segments', () => {
    const obj = {
      words: [
        { channel: 1, result: [{ s: 0, w: 'foo' }] },
        { channel: 1, result: [{ s: 1, w: 'bar' }] },
        { channel: 2, result: [{ s: 2, w: 'baz' }] },
        { channel: 1, result: [{ s: 3, w: 'qux' }] },
      ],
    };
    expect(extractDialogTurns(obj)).toEqual([
      { channel: 1, text: 'foo bar' },
      { channel: 2, text: 'baz' },
      { channel: 1, text: 'qux' },
    ]);
  });

  it('handles mono recordings (no channel field) as a single null-channel turn', () => {
    const obj = {
      words: [
        { result: [{ s: 0, w: 'hello' }] },
        { result: [{ s: 1, w: 'world' }] },
      ],
    };
    expect(extractDialogTurns(obj)).toEqual([
      { channel: null, text: 'hello world' },
    ]);
  });

  it('skips segments whose words list is empty or missing text', () => {
    const obj = {
      words: [
        { channel: 1, result: [{ s: 0, w: '' }, { s: 0.5, w: undefined }] },
        { channel: 1, result: [{ s: 1, w: 'real' }] },
      ],
    };
    expect(extractDialogTurns(obj)).toEqual([
      { channel: 1, text: 'real' },
    ]);
  });

  it('returns null when every segment is empty', () => {
    const obj = {
      words: [
        { channel: 1, result: [] },
        { channel: 2, result: [{ w: '' }] },
      ],
    };
    expect(extractDialogTurns(obj)).toBeNull();
  });
});
