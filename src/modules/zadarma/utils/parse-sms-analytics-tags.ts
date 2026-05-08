export type SmsCategory =
  | 'TRANSACTIONAL'
  | 'MARKETING'
  | 'REMINDER'
  | 'FOLLOWUP'
  | 'CONFIRMATION'
  | 'OTHER';

export type SmsSource =
  | 'CHAT_PANEL'
  | 'N8N'
  | 'TWENTY_WORKFLOW'
  | 'EXTERNAL_API'
  | 'INBOUND'
  | 'OTHER';

export type SmsAnalyticsTags = {
  category: SmsCategory;
  source: SmsSource;
  templateName: string | null;
  campaignId: string | null;
};

export type RawAnalyticsInput = {
  category?: string | null;
  source?: string | null;
  templateName?: string | null;
  campaignId?: string | null;
};

const VALID_CATEGORIES: ReadonlySet<SmsCategory> = new Set([
  'TRANSACTIONAL',
  'MARKETING',
  'REMINDER',
  'FOLLOWUP',
  'CONFIRMATION',
  'OTHER',
]);

const VALID_SOURCES: ReadonlySet<SmsSource> = new Set([
  'CHAT_PANEL',
  'N8N',
  'TWENTY_WORKFLOW',
  'EXTERNAL_API',
  'INBOUND',
  'OTHER',
]);

const isCategory = (v: unknown): v is SmsCategory =>
  typeof v === 'string' && VALID_CATEGORIES.has(v as SmsCategory);

const isSource = (v: unknown): v is SmsSource =>
  typeof v === 'string' && VALID_SOURCES.has(v as SmsSource);

const normalizeText = (v: string | null | undefined): string | null => {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
};

// Parses caller-supplied analytics tags from the /send-sms request body.
// Unknown enum values fall back to 'OTHER' (not a hard error — the caller
// might be on a newer client speaking values we have not minted yet, and we
// prefer logging the row over rejecting the send). Free-form fields are
// trimmed and empty strings collapse to null.
export const parseSmsAnalyticsTags = (
  input: RawAnalyticsInput,
): SmsAnalyticsTags => {
  return {
    category: isCategory(input.category) ? input.category : 'OTHER',
    source: isSource(input.source) ? input.source : 'OTHER',
    templateName: normalizeText(input.templateName),
    campaignId: normalizeText(input.campaignId),
  };
};
