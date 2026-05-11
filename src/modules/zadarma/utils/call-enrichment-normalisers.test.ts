import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetLegacyKeyWarnings,
  normaliseAction,
  normaliseInterestLevel,
  normaliseKeyFacts,
  normaliseKeyTopics,
  normaliseOutcome,
  normaliseScore,
  normaliseSentiment,
  pickEnrichmentKey,
} from './call-enrichment-normalisers';

describe('normaliseSentiment', () => {
  it.each([
    ['POSITIVE', 'POSITIVE'],
    ['negative', 'NEGATIVE'],
    [' Neutral ', 'NEUTRAL'],
    ['unknown', 'UNKNOWN'],
  ])('accepts %s → %s', (input, expected) => {
    expect(normaliseSentiment(input)).toBe(expected);
  });

  it.each([['HAPPY', null], [undefined, null], [null, null], [42, null], [{}, null]])(
    'rejects %s → null',
    (input, expected) => {
      expect(normaliseSentiment(input)).toBe(expected);
    },
  );
});

describe('normaliseAction', () => {
  it('accepts every documented value, case-insensitively', () => {
    const values = [
      'NONE',
      'SMS_FOLLOWUP',
      'EMAIL_OFFER',
      'CALLBACK',
      'OPERATOR_TASK',
      'HUMAN_TRANSFER',
      'DO_NOT_CONTACT',
    ];
    for (const v of values) {
      expect(normaliseAction(v.toLowerCase())).toBe(v);
    }
  });

  it('rejects unknown values → null', () => {
    expect(normaliseAction('TASK')).toBeNull();
    expect(normaliseAction('')).toBeNull();
    expect(normaliseAction(undefined)).toBeNull();
  });
});

describe('normaliseOutcome', () => {
  it.each([
    ['WON', 'WON'],
    ['lost', 'LOST'],
    [' Followup ', 'FOLLOWUP'],
    ['disqualified', 'DISQUALIFIED'],
    ['NO_CONTACT', 'NO_CONTACT'],
    ['callback', 'CALLBACK'],
    ['INCOMPLETE', 'INCOMPLETE'],
    ['other', 'OTHER'],
  ])('accepts %s → %s', (input, expected) => {
    expect(normaliseOutcome(input)).toBe(expected);
  });

  it('rejects unknown values', () => {
    expect(normaliseOutcome('BOOKED')).toBeNull(); // domain-specific, not in universal enum
    expect(normaliseOutcome('won_again')).toBeNull();
    expect(normaliseOutcome('')).toBeNull();
    expect(normaliseOutcome(undefined)).toBeNull();
  });
});

describe('normaliseInterestLevel', () => {
  it('passes 1-5 through', () => {
    for (const v of [1, 2, 3, 4, 5]) {
      expect(normaliseInterestLevel(v)).toBe(v);
    }
  });

  it('rounds fractional values', () => {
    expect(normaliseInterestLevel(3.4)).toBe(3);
    expect(normaliseInterestLevel(3.6)).toBe(4);
  });

  it('clamps out-of-range values rather than rejecting', () => {
    expect(normaliseInterestLevel(0)).toBe(1);
    expect(normaliseInterestLevel(-2)).toBe(1);
    expect(normaliseInterestLevel(6)).toBe(5);
    expect(normaliseInterestLevel(99)).toBe(5);
  });

  it.each([[null, null], [undefined, null], [NaN, null], [Infinity, null], ['4', null]])(
    'rejects non-number %s → null',
    (input, expected) => {
      expect(normaliseInterestLevel(input)).toBe(expected);
    },
  );
});

describe('normaliseScore', () => {
  it('passes 1-5 through', () => {
    for (const v of [1, 2, 3, 4, 5]) {
      expect(normaliseScore(v)).toBe(v);
    }
  });

  it('rounds fractional values', () => {
    expect(normaliseScore(2.3)).toBe(2);
    expect(normaliseScore(2.7)).toBe(3);
  });

  it('collapses 0 (or any sub-1 value) to null = "skip"', () => {
    expect(normaliseScore(0)).toBeNull();
    expect(normaliseScore(-1)).toBeNull();
    expect(normaliseScore(0.4)).toBeNull(); // rounds to 0 → null
  });

  it('clamps high values to 5', () => {
    expect(normaliseScore(6)).toBe(5);
    expect(normaliseScore(99)).toBe(5);
  });

  it.each([[null, null], [undefined, null], [NaN, null], [Infinity, null]])(
    'rejects non-finite %s → null',
    (input, expected) => {
      expect(normaliseScore(input)).toBe(expected);
    },
  );
});

describe('normaliseKeyTopics', () => {
  it('returns trimmed string-only entries', () => {
    expect(normaliseKeyTopics(['  a  ', 'b', 'objection:price'])).toEqual([
      'a',
      'b',
      'objection:price',
    ]);
  });

  it('drops non-string and empty entries; returns null on empty result', () => {
    expect(normaliseKeyTopics([1, '', ' ', null, true])).toBeNull();
  });

  it('returns null for non-arrays', () => {
    expect(normaliseKeyTopics({})).toBeNull();
    expect(normaliseKeyTopics(undefined)).toBeNull();
    expect(normaliseKeyTopics('a')).toBeNull();
  });
});

describe('normaliseKeyFacts', () => {
  it('accepts well-formed [{type, value}] pairs', () => {
    expect(
      normaliseKeyFacts([
        { type: 'specialty', value: 'kosmetolog' },
        { type: 'city', value: 'Krakow' },
      ]),
    ).toEqual([
      { type: 'specialty', value: 'kosmetolog' },
      { type: 'city', value: 'Krakow' },
    ]);
  });

  it('trims whitespace on both fields', () => {
    expect(normaliseKeyFacts([{ type: ' city ', value: ' Krakow ' }])).toEqual([
      { type: 'city', value: 'Krakow' },
    ]);
  });

  it('drops entries with empty type or value', () => {
    expect(
      normaliseKeyFacts([
        { type: 'a', value: 'b' },
        { type: '', value: 'c' },
        { type: 'd', value: '' },
        { type: '   ', value: 'e' },
      ]),
    ).toEqual([{ type: 'a', value: 'b' }]);
  });

  it('drops non-object entries and non-string type/value', () => {
    expect(
      normaliseKeyFacts([
        { type: 'a', value: 'b' },
        null,
        'not-an-object',
        { type: 1, value: 'b' },
        { type: 'a', value: 99 },
      ]),
    ).toEqual([{ type: 'a', value: 'b' }]);
  });

  it('returns null when nothing survives', () => {
    expect(normaliseKeyFacts([])).toBeNull();
    expect(normaliseKeyFacts([{ type: '', value: '' }])).toBeNull();
    expect(normaliseKeyFacts(undefined)).toBeNull();
    expect(normaliseKeyFacts('lots of facts')).toBeNull();
  });
});

describe('pickEnrichmentKey', () => {
  beforeEach(() => {
    __resetLegacyKeyWarnings();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the new value when provided, ignoring the legacy one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(pickEnrichmentKey('POSITIVE', 'NEGATIVE', 'aiSentiment', 'sentiment')).toBe(
      'POSITIVE',
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to the legacy value and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(pickEnrichmentKey(undefined, 'NEUTRAL', 'aiSentiment', 'sentiment')).toBe(
      'NEUTRAL',
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('"aiSentiment"');
    expect(warn.mock.calls[0]?.[0]).toContain('"sentiment"');

    // Second call with the SAME legacy key should NOT warn again.
    expect(pickEnrichmentKey(undefined, 'POSITIVE', 'aiSentiment', 'sentiment')).toBe(
      'POSITIVE',
    );
    expect(warn).toHaveBeenCalledTimes(1);

    // Different legacy key warns on its first appearance.
    expect(
      pickEnrichmentKey(undefined, 3, 'aiInterestLevel', 'interestLevel'),
    ).toBe(3);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('returns undefined when both new and legacy values are missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(
      pickEnrichmentKey(undefined, undefined, 'aiSentiment', 'sentiment'),
    ).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it('treats `null` as a present (non-undefined) new value — wins over legacy', () => {
    expect(pickEnrichmentKey(null, 'POSITIVE', 'aiSentiment', 'sentiment')).toBeNull();
  });

  it('treats `false` as a present (non-undefined) new boolean — wins over legacy', () => {
    expect(pickEnrichmentKey(false, true, 'aiSuccessful', 'successful')).toBe(false);
  });
});
