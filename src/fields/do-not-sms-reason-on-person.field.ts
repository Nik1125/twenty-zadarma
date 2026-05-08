import {
  defineField,
  FieldType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

export const DO_NOT_SMS_REASON_FIELD_UNIVERSAL_IDENTIFIER =
  'd5e7ad14-3a26-418f-b75e-4b45be83e871';

// Free-text explanation of why doNotSms was set — typically a short quote
// from the inbound SMS that triggered the opt-out (e.g. "nie pisz proszę"),
// captured by the external classifier. Surfaced in the panel banner so a
// manager understands the context without opening n8n logs.
export default defineField({
  universalIdentifier: DO_NOT_SMS_REASON_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.TEXT,
  name: 'doNotSmsReason',
  label: 'Do not SMS reason',
  description:
    'Short free-text explanation of why doNotSms was set (typically the originating SMS quote). Populated by the external automation that flipped the flag.',
  icon: 'IconQuote',
  isNullable: true,
});
