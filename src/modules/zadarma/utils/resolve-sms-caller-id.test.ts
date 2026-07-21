import { describe, expect, it } from 'vitest';

import { resolveSmsCallerId } from './resolve-sms-caller-id';

describe('resolveSmsCallerId', () => {
  it('falls back to ourNumber when senderId is undefined', () => {
    expect(resolveSmsCallerId(undefined, '48570000808')).toBe('48570000808');
  });

  it('falls back to ourNumber when senderId is null', () => {
    expect(resolveSmsCallerId(null, '48570000808')).toBe('48570000808');
  });

  it('falls back to ourNumber when senderId is empty string', () => {
    expect(resolveSmsCallerId('', '48570000808')).toBe('48570000808');
  });

  it('falls back to ourNumber when senderId is only whitespace', () => {
    expect(resolveSmsCallerId('   ', '48570000808')).toBe('48570000808');
  });

  it('uses the registered alphanumeric Sender ID when configured', () => {
    expect(resolveSmsCallerId('Hyalual', '48570000808')).toBe('Hyalual');
  });

  it('trims surrounding whitespace on a configured senderId', () => {
    expect(resolveSmsCallerId('  Hyalual  ', '48570000808')).toBe('Hyalual');
  });
});
