import { describe, expect, it } from 'vitest';

import {
  formatOptOutMessage,
  isOptedOutOfSms,
} from 'src/modules/zadarma/utils/is-opted-out-of-sms';

describe('isOptedOutOfSms', () => {
  it('returns false when person is null', () => {
    expect(isOptedOutOfSms(null)).toBe(false);
  });

  it('returns false when person is undefined', () => {
    expect(isOptedOutOfSms(undefined)).toBe(false);
  });

  it('returns false when doNotSms is null (legacy migrated row)', () => {
    expect(isOptedOutOfSms({ doNotSms: null })).toBe(false);
  });

  it('returns false when doNotSms is undefined', () => {
    expect(isOptedOutOfSms({})).toBe(false);
  });

  it('returns false when doNotSms is false', () => {
    expect(isOptedOutOfSms({ doNotSms: false })).toBe(false);
  });

  it('returns true when doNotSms is true', () => {
    expect(isOptedOutOfSms({ doNotSms: true })).toBe(true);
  });

  it('does not coerce truthy non-boolean values to opt-out', () => {
    // Defensive: GraphQL may return string 'true' from misconfigured clients.
    // We deliberately use === true to avoid false positives.
    expect(isOptedOutOfSms({ doNotSms: 'true' as unknown as boolean })).toBe(
      false,
    );
    expect(isOptedOutOfSms({ doNotSms: 1 as unknown as boolean })).toBe(false);
  });
});

describe('formatOptOutMessage', () => {
  it('uses placeholders when fields are missing', () => {
    expect(formatOptOutMessage({ doNotSms: true })).toBe(
      'Person has opted out of SMS (unknown date). Reason: no reason recorded.',
    );
  });

  it('formats with full details', () => {
    expect(
      formatOptOutMessage({
        doNotSms: true,
        doNotSmsAt: '2026-05-08T10:00:00Z',
        doNotSmsReason: 'nie pisz proszę',
      }),
    ).toBe(
      'Person has opted out of SMS (2026-05-08T10:00:00Z). Reason: nie pisz proszę.',
    );
  });

  it('handles partial details', () => {
    expect(
      formatOptOutMessage({
        doNotSms: true,
        doNotSmsAt: '2026-05-08T10:00:00Z',
      }),
    ).toBe(
      'Person has opted out of SMS (2026-05-08T10:00:00Z). Reason: no reason recorded.',
    );
  });

  it('treats empty string the same as null (Twenty TEXT default)', () => {
    expect(
      formatOptOutMessage({
        doNotSms: true,
        doNotSmsAt: '',
        doNotSmsReason: '',
      }),
    ).toBe(
      'Person has opted out of SMS (unknown date). Reason: no reason recorded.',
    );
  });
});
