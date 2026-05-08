import { describe, expect, it } from 'vitest';

import { parseAiExtensions } from './parse-ai-extensions';

describe('parseAiExtensions', () => {
  it('returns empty array for empty/undefined', () => {
    expect(parseAiExtensions(undefined)).toEqual([]);
    expect(parseAiExtensions('')).toEqual([]);
  });

  it('parses single extension', () => {
    expect(parseAiExtensions('103')).toEqual(['103']);
  });

  it('parses comma-separated list', () => {
    expect(parseAiExtensions('103,105')).toEqual(['103', '105']);
  });

  it('tolerates whitespace', () => {
    expect(parseAiExtensions('  103 , 104, 105  ')).toEqual(['103', '104', '105']);
  });

  it('filters non-digit tokens', () => {
    expect(parseAiExtensions('103,abc,105')).toEqual(['103', '105']);
    expect(parseAiExtensions('103,1a3,105')).toEqual(['103', '105']);
  });

  it('handles trailing comma', () => {
    expect(parseAiExtensions('103,')).toEqual(['103']);
  });
});
