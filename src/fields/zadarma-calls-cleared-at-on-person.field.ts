import {
  defineField,
  FieldType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

export const ZADARMA_CALLS_CLEARED_AT_FIELD_UNIVERSAL_IDENTIFIER =
  'ab2911ea-53a8-4f54-a61e-756f3845e3f6';

// Inbox dismiss marker for the Calls channel — the missed-calls mirror of
// zadarmaSmsClearedAt. The Zadarma Inbox "Calls" tab shows a Person while the
// count of missed inbound calls after max(last outbound call, last real-answered
// inbound call, this timestamp) is > 0. Calling the client back (any outbound
// call) or them re-calling and us picking up auto-clears the thread; this field
// is the *manual* clear — the operator decides no callback is owed, hits the ✓,
// and we stamp now() here so those missed calls drop off the inbox. New missed
// calls after this time count from zero again. Derived model: the missed count
// is never stored — only this dismiss intent, which can't be inferred from the
// call logs. See [[project-sms-inbox-standalone-page]].
export default defineField({
  universalIdentifier: ZADARMA_CALLS_CLEARED_AT_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.DATE_TIME,
  name: 'zadarmaCallsClearedAt',
  label: 'Zadarma calls cleared at',
  description:
    'Inbox dismiss marker for missed calls: missed inbound calls at or before this time are treated as handled (no callback owed). Set by the Zadarma Inbox "Calls" tab ✓ button. The missed-call count is derived as missed inbound calls after max(last outbound call, last real-answered inbound call, this).',
  icon: 'IconPhone',
  isNullable: true,
});
