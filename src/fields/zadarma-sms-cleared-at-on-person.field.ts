import {
  defineField,
  FieldType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

export const ZADARMA_SMS_CLEARED_AT_FIELD_UNIVERSAL_IDENTIFIER =
  '06684f21-4d5c-4c5c-95ee-1ea9577751d7';

// Inbox dismiss marker for the SMS channel. The Zadarma Inbox shows a Person
// as "unanswered" while the count of inbound SMS after max(last outbound SMS,
// this timestamp) is > 0. Replying advances "last outbound" and auto-clears
// the thread; this field is the *manual* clear — the operator decides a reply
// isn't needed (e.g. the customer's last message was "спасибо"), hits the
// reset button, and we stamp now() here so those messages drop off the inbox
// without sending anything. New inbound SMS after this time count from zero
// again. Derived model: the unread count is never stored — only this dismiss
// intent, which can't be inferred from the logs. See [[project-sms-inbox-standalone-page]].
export default defineField({
  universalIdentifier: ZADARMA_SMS_CLEARED_AT_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.DATE_TIME,
  name: 'zadarmaSmsClearedAt',
  label: 'Zadarma SMS cleared at',
  description:
    'Inbox dismiss marker: inbound SMS at or before this time are treated as handled (no reply needed). Set by the Zadarma Inbox "mark read" button. The unread SMS count is derived as inbound messages after max(last outbound SMS, this).',
  icon: 'IconInbox',
  isNullable: true,
});
