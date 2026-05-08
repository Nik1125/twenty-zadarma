import {
  defineField,
  FieldType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

export const DO_NOT_SMS_AT_FIELD_UNIVERSAL_IDENTIFIER =
  '7a968144-99a5-4396-9095-d989878ca902';

// GDPR audit trail: timestamp captured by external automation when doNotSms
// is set to true. The App never writes here directly. Surfaced in the chat
// panel banner so operators see when the opt-out was recorded.
export default defineField({
  universalIdentifier: DO_NOT_SMS_AT_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.DATE_TIME,
  name: 'doNotSmsAt',
  label: 'Do not SMS at',
  description:
    'Timestamp when the doNotSms flag was last set. Populated by the external automation that flipped the flag (n8n / Twenty Workflow / manual toggle) for GDPR audit trail.',
  icon: 'IconClockOff',
  isNullable: true,
});
