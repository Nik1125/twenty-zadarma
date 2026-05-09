import { describe, expect, it } from 'vitest';

import { buildTeamSalePayload } from './build-teamsale-payload';

describe('buildTeamSalePayload', () => {
  it('returns null when no primary phone is set', () => {
    expect(
      buildTeamSalePayload({
        name: { firstName: 'Anna', lastName: 'Kowalska' },
        phones: null,
      }),
    ).toBeNull();
    expect(
      buildTeamSalePayload({
        name: { firstName: 'Anna', lastName: 'Kowalska' },
        phones: { primaryPhoneNumber: '' },
      }),
    ).toBeNull();
  });

  it('combines firstName + lastName for the name field', () => {
    const out = buildTeamSalePayload({
      name: { firstName: 'Anna', lastName: 'Kowalska' },
      phones: { primaryPhoneNumber: '+48579872402' },
    });
    expect(out?.name).toBe('Anna Kowalska');
  });

  it('uses lastName-only when firstName empty (company-as-person)', () => {
    const out = buildTeamSalePayload({
      name: { firstName: '', lastName: 'Skin Logic' },
      phones: { primaryPhoneNumber: '+48579872402' },
    });
    expect(out?.name).toBe('Skin Logic');
  });

  it('falls back to phone when both name parts empty', () => {
    const out = buildTeamSalePayload({
      name: { firstName: '', lastName: '' },
      phones: { primaryPhoneNumber: '+48579872402' },
    });
    expect(out?.name).toBe('+48579872402');
  });

  it('passes phone verbatim when it already starts with +', () => {
    const out = buildTeamSalePayload({
      name: { firstName: 'X', lastName: 'Y' },
      phones: { primaryPhoneNumber: '+48579872402' },
    });
    expect(out?.phone).toBe('+48579872402');
  });

  it('prepends + when phone has no leading + and no callingCode', () => {
    const out = buildTeamSalePayload({
      name: { firstName: 'X', lastName: 'Y' },
      phones: { primaryPhoneNumber: '48579872402' },
    });
    expect(out?.phone).toBe('+48579872402');
  });

  it('combines callingCode + number when number has no + and digits do not include cc', () => {
    const out = buildTeamSalePayload({
      name: { firstName: 'X', lastName: 'Y' },
      phones: {
        primaryPhoneNumber: '579872402',
        primaryPhoneCallingCode: '+48',
      },
    });
    expect(out?.phone).toBe('+48579872402');
  });

  it('handles callingCode without leading + by adding one', () => {
    const out = buildTeamSalePayload({
      name: { firstName: 'X', lastName: 'Y' },
      phones: {
        primaryPhoneNumber: '579872402',
        primaryPhoneCallingCode: '48',
      },
    });
    expect(out?.phone).toBe('+48579872402');
  });

  it('avoids double-prefix when number already includes the callingCode digits', () => {
    const out = buildTeamSalePayload({
      name: { firstName: 'X', lastName: 'Y' },
      phones: {
        primaryPhoneNumber: '48579872402',
        primaryPhoneCallingCode: '+48',
      },
    });
    expect(out?.phone).toBe('+48579872402');
  });

  it('defaults leadSource to "inbound_call"', () => {
    const out = buildTeamSalePayload({
      name: { firstName: 'X', lastName: 'Y' },
      phones: { primaryPhoneNumber: '+48579872402' },
    });
    expect(out?.leadSource).toBe('inbound_call');
  });

  it('honours overridden leadSource', () => {
    const out = buildTeamSalePayload(
      {
        name: { firstName: 'X', lastName: 'Y' },
        phones: { primaryPhoneNumber: '+48579872402' },
      },
      { leadSource: 'form' },
    );
    expect(out?.leadSource).toBe('form');
  });

  it('includes comment when provided and non-empty', () => {
    const out = buildTeamSalePayload(
      {
        name: { firstName: 'X', lastName: 'Y' },
        phones: { primaryPhoneNumber: '+48579872402' },
      },
      { comment: 'From FB lead form' },
    );
    expect(out?.comment).toBe('From FB lead form');
  });

  it('omits comment when not provided', () => {
    const out = buildTeamSalePayload({
      name: { firstName: 'X', lastName: 'Y' },
      phones: { primaryPhoneNumber: '+48579872402' },
    });
    expect(out?.comment).toBeUndefined();
  });
});
