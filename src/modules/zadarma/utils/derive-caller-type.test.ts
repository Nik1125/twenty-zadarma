import { describe, expect, it } from 'vitest';

import { deriveCallerType } from './derive-caller-type';

describe('deriveCallerType', () => {
  it('returns AI when extension is listed in AI_EXTENSIONS', () => {
    expect(deriveCallerType('102', ['102', '103'])).toBe('AI');
    expect(deriveCallerType('103', ['102', '103'])).toBe('AI');
  });

  it('returns HUMAN when extension is set but not in AI_EXTENSIONS', () => {
    expect(deriveCallerType('101', ['102', '103'])).toBe('HUMAN');
    expect(deriveCallerType('999', [])).toBe('HUMAN');
  });

  it('returns UNKNOWN when extension is missing/empty', () => {
    expect(deriveCallerType(undefined, ['102'])).toBe('UNKNOWN');
    expect(deriveCallerType(null, ['102'])).toBe('UNKNOWN');
    expect(deriveCallerType('', ['102'])).toBe('UNKNOWN');
  });

  it('treats whitespace-only extension as missing', () => {
    expect(deriveCallerType('   ', ['102'])).toBe('UNKNOWN');
  });

  it('trims surrounding whitespace before matching', () => {
    expect(deriveCallerType(' 102 ', ['102'])).toBe('AI');
    expect(deriveCallerType('102\t', ['102'])).toBe('AI');
  });

  it('falls back to HUMAN when AI_EXTENSIONS is empty and extension is set', () => {
    expect(deriveCallerType('101', [])).toBe('HUMAN');
    expect(deriveCallerType('102', [])).toBe('HUMAN');
  });

  it('is case-sensitive on the extension string (digits only in practice)', () => {
    // parseAiExtensions filters non-digit tokens so this is mostly defensive,
    // but verify exact-match behaviour at this layer.
    expect(deriveCallerType('102', ['1020'])).toBe('HUMAN');
    expect(deriveCallerType('1020', ['102'])).toBe('HUMAN');
  });
});
