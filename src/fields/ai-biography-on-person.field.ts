import {
  defineField,
  FieldType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import { AI_BIOGRAPHY_FIELD_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

// Condensed AI-maintained biography of the Person. Markdown content
// summarising who the client is, what they want, current status, and
// preferences — populated and refreshed by external automation
// (Twenty Workflow + n8n / direct n8n flow). The App owns the storage
// only; refresh policy + LLM prompt are workspace-specific and live
// outside the App's code.
//
// Recommended trigger flows (see docs/AI_BIOGRAPHY.md for details):
//
//   Calls — Twenty Workflow
//     Trigger: callLog updated where `summary` becomes non-null (or
//              changed). The "AI summary" is set by the n8n
//              call-enrichment adapter when post-call analysis lands;
//              that's the moment the call's full context is available.
//     Action:  HTTP POST to an n8n webhook with { callLogId, personId }.
//     n8n:     read Person.aiBiography + the new callLog → LLM → write
//              Person.aiBiography.
//
//   SMS — n8n directly
//     Inbound SMS classifier already runs in n8n. After classifying as
//     a meaningful intent, the same n8n workflow fires its own
//     bio-update sub-flow with the personId. No Twenty Workflow needed
//     for the SMS path.
//
//   Legacy backfill — n8n script
//     One-off loop over Persons WHERE aiBiography IS NULL with a
//     primary phone — pulls history, generates bios, writes back.
//     Throttled to stay under LLM-provider rate limits.
//
// Failure handling: on LLM error the n8n handler appends a small
// `_⚠ Last refresh failed at <ts>_` footer to the existing markdown.
// The next successful update overwrites the whole field, clearing the
// marker. No separate `bioStatus` field is needed for v1 — the marker
// is visible to the operator inline. Add a status enum later if
// dashboards or SLA-tracking demand it.
export default defineField({
  universalIdentifier: AI_BIOGRAPHY_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.RICH_TEXT,
  name: 'aiBiography',
  label: 'AI biography',
  description:
    'Condensed AI-maintained biography of this contact. Auto-refreshed by external automation (Twenty Workflow + n8n) on every meaningful call or SMS. See docs/AI_BIOGRAPHY.md for the trigger configuration.',
  icon: 'IconUserSearch',
  isNullable: true,
});
