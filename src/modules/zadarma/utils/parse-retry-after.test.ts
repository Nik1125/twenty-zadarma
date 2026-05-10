import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseRetryAfter } from './parse-retry-after';

describe('parseRetryAfter', () => {
  describe('delta-seconds format', () => {
    it('returns the integer for plain digits', () => {
      expect(parseRetryAfter('60')).toBe(60);
    });

    it('handles whitespace padding', () => {
      expect(parseRetryAfter('  120  ')).toBe(120);
    });

    it('returns 0 for "0" (immediate retry allowed)', () => {
      expect(parseRetryAfter('0')).toBe(0);
    });

    it('handles large values', () => {
      expect(parseRetryAfter('86400')).toBe(86400);
    });
  });

  describe('HTTP-date format', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('parses RFC 7231 date and computes diff in seconds', () => {
      // 90 seconds in the future
      expect(parseRetryAfter('Sun, 10 May 2026 12:01:30 GMT')).toBe(90);
    });

    it('returns default for past dates', () => {
      expect(parseRetryAfter('Sun, 10 May 2026 11:59:00 GMT')).toBe(60);
    });

    it('handles ISO-like strings', () => {
      expect(parseRetryAfter('2026-05-10T12:00:30Z')).toBe(30);
    });
  });

  describe('fallbacks', () => {
    it('returns default for null', () => {
      expect(parseRetryAfter(null)).toBe(60);
    });

    it('returns default for undefined', () => {
      expect(parseRetryAfter(undefined)).toBe(60);
    });

    it('returns default for empty string', () => {
      expect(parseRetryAfter('')).toBe(60);
    });

    it('returns default for malformed input', () => {
      expect(parseRetryAfter('not-a-date')).toBe(60);
    });

    it('returns default for negative numbers', () => {
      // -5 fails the digits-only regex and Date.parse, so falls through.
      expect(parseRetryAfter('-5')).toBe(60);
    });
  });
});
