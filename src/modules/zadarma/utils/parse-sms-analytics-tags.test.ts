import { describe, expect, it } from 'vitest';

import { parseSmsAnalyticsTags } from 'src/modules/zadarma/utils/parse-sms-analytics-tags';

describe('parseSmsAnalyticsTags', () => {
  it('returns full defaults for an empty input', () => {
    expect(parseSmsAnalyticsTags({})).toEqual({
      category: 'OTHER',
      source: 'OTHER',
      templateName: null,
      campaignId: null,
    });
  });

  it('passes through valid enum values', () => {
    expect(
      parseSmsAnalyticsTags({
        category: 'REMINDER',
        source: 'N8N',
        templateName: 'appointment_reminder_pl',
        campaignId: 'spring_2026_promo',
      }),
    ).toEqual({
      category: 'REMINDER',
      source: 'N8N',
      templateName: 'appointment_reminder_pl',
      campaignId: 'spring_2026_promo',
    });
  });

  it('falls back to OTHER on unknown category', () => {
    expect(
      parseSmsAnalyticsTags({ category: 'NONSENSE', source: 'N8N' }),
    ).toEqual({
      category: 'OTHER',
      source: 'N8N',
      templateName: null,
      campaignId: null,
    });
  });

  it('falls back to OTHER on unknown source', () => {
    expect(
      parseSmsAnalyticsTags({ category: 'REMINDER', source: 'discord_bot' }),
    ).toEqual({
      category: 'REMINDER',
      source: 'OTHER',
      templateName: null,
      campaignId: null,
    });
  });

  it('rejects non-string enum values defensively', () => {
    expect(
      parseSmsAnalyticsTags({
        category: 42 as unknown as string,
        source: null,
      }),
    ).toEqual({
      category: 'OTHER',
      source: 'OTHER',
      templateName: null,
      campaignId: null,
    });
  });

  it('trims whitespace and collapses empty strings to null on free-form fields', () => {
    expect(
      parseSmsAnalyticsTags({
        templateName: '   ',
        campaignId: '',
      }),
    ).toEqual({
      category: 'OTHER',
      source: 'OTHER',
      templateName: null,
      campaignId: null,
    });

    expect(
      parseSmsAnalyticsTags({
        templateName: '  appointment_reminder_pl  ',
        campaignId: '  spring_2026  ',
      }),
    ).toEqual({
      category: 'OTHER',
      source: 'OTHER',
      templateName: 'appointment_reminder_pl',
      campaignId: 'spring_2026',
    });
  });

  it('case-sensitive on enum values (caller must use exact uppercase)', () => {
    expect(
      parseSmsAnalyticsTags({ category: 'reminder', source: 'n8n' }),
    ).toEqual({
      category: 'OTHER',
      source: 'OTHER',
      templateName: null,
      campaignId: null,
    });
  });

  it('handles INBOUND source for webhook-created rows', () => {
    expect(parseSmsAnalyticsTags({ source: 'INBOUND' })).toEqual({
      category: 'OTHER',
      source: 'INBOUND',
      templateName: null,
      campaignId: null,
    });
  });

  it('accepts all six categories', () => {
    for (const cat of ['TRANSACTIONAL', 'MARKETING', 'REMINDER', 'FOLLOWUP', 'CONFIRMATION', 'OTHER']) {
      expect(parseSmsAnalyticsTags({ category: cat }).category).toBe(cat);
    }
  });

  it('accepts all six sources', () => {
    for (const src of ['CHAT_PANEL', 'N8N', 'TWENTY_WORKFLOW', 'EXTERNAL_API', 'INBOUND', 'OTHER']) {
      expect(parseSmsAnalyticsTags({ source: src }).source).toBe(src);
    }
  });
});
