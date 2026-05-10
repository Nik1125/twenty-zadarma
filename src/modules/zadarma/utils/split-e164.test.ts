import { describe, expect, it } from 'vitest';

import { splitE164 } from './split-e164';

describe('splitE164', () => {
  describe('common European codes', () => {
    it('splits Polish numbers (48)', () => {
      expect(splitE164('48579872402')).toEqual({
        callingCode: '48',
        subscriber: '579872402',
      });
    });

    it('splits Ukrainian numbers (380, 3-digit code)', () => {
      expect(splitE164('380501234567')).toEqual({
        callingCode: '380',
        subscriber: '501234567',
      });
    });

    it('splits German numbers (49)', () => {
      expect(splitE164('491701234567')).toEqual({
        callingCode: '49',
        subscriber: '1701234567',
      });
    });

    it('splits UK numbers (44)', () => {
      expect(splitE164('447911123456')).toEqual({
        callingCode: '44',
        subscriber: '7911123456',
      });
    });

    it('prefers longer prefix when a shorter one is also a prefix substring', () => {
      // 380 must win over 38 (which is not in the table; this test confirms
      // ordering protects against a hypothetical addition).
      expect(splitE164('380501234567').callingCode).toBe('380');
    });
  });

  describe('non-European codes', () => {
    it('splits North-American numbers (1)', () => {
      expect(splitE164('15551234567')).toEqual({
        callingCode: '1',
        subscriber: '5551234567',
      });
    });

    it('splits Russian numbers (7)', () => {
      expect(splitE164('79161234567')).toEqual({
        callingCode: '7',
        subscriber: '9161234567',
      });
    });
  });

  describe('input normalization', () => {
    it('strips non-digit characters', () => {
      expect(splitE164('+48 579-872 402')).toEqual({
        callingCode: '48',
        subscriber: '579872402',
      });
    });
  });

  describe('fallback behaviour', () => {
    it('returns null callingCode for unknown prefix', () => {
      // 999 is not allocated as a country code in the table.
      expect(splitE164('99988877766')).toEqual({
        callingCode: null,
        subscriber: '99988877766',
      });
    });

    it('returns empty for null/undefined/empty', () => {
      expect(splitE164(null)).toEqual({ callingCode: null, subscriber: '' });
      expect(splitE164(undefined)).toEqual({
        callingCode: null,
        subscriber: '',
      });
      expect(splitE164('')).toEqual({ callingCode: null, subscriber: '' });
    });

    it('returns empty for non-digit input', () => {
      expect(splitE164('not a phone')).toEqual({
        callingCode: null,
        subscriber: '',
      });
    });
  });

  describe('cross-country collision protection (the issue this guards)', () => {
    it('PL and UA numbers sharing the last 9 digits are distinguished by callingCode', () => {
      // The whole point: subscribers ARE identical (`579872402`). Without the
      // cc guard, fuzzy `endsWith(last9)` would match both. With the guard,
      // the callingCode disambiguates them at the GraphQL filter layer.
      const pl = splitE164('48579872402');
      const ua = splitE164('380579872402');
      expect(pl.subscriber).toBe(ua.subscriber);
      expect(pl.callingCode).toBe('48');
      expect(ua.callingCode).toBe('380');
      expect(pl.callingCode).not.toBe(ua.callingCode);
    });
  });
});
