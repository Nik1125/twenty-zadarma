import { describe, expect, it } from 'vitest';

import { normalizePhone } from './normalize-phone';

describe('normalizePhone', () => {
  it('strips leading plus', () => {
    expect(normalizePhone('+48570000808')).toBe('48570000808');
  });

  it('strips spaces and dashes', () => {
    expect(normalizePhone('+48 573-580 808')).toBe('48570000808');
  });

  it('strips parentheses', () => {
    expect(normalizePhone('+1 (555) 123-4567')).toBe('15551234567');
  });

  it('returns null for null/undefined', () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(normalizePhone('')).toBeNull();
  });

  it('returns null for non-digit-only string', () => {
    expect(normalizePhone('not a phone')).toBeNull();
  });

  it('preserves all digits including leading zeros', () => {
    expect(normalizePhone('00 48 573 580 808')).toBe('0048570000808');
  });

  it('handles already-normalized input', () => {
    expect(normalizePhone('48570000808')).toBe('48570000808');
  });
});
