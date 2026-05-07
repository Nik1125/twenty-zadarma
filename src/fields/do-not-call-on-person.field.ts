import {
  defineField,
  FieldType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

export const DO_NOT_CALL_FIELD_UNIVERSAL_IDENTIFIER =
  'aba1a998-9df5-4f8d-8a57-c2d8662e1274';

// Universal opt-out flag. The App never writes to this field — it only reads
// it before any outbound action (future click-to-call button, send-sms
// logic-function). External automations (n8n, Retell, manual UI toggle, Twenty
// Workflow) own the write side. This keeps business logic out of the App and
// gives every workspace a single GDPR-friendly contact-control point.
export default defineField({
  universalIdentifier: DO_NOT_CALL_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.BOOLEAN,
  name: 'doNotCall',
  label: 'Do not call',
  description:
    'Marks this Person as opted-out of outbound calls and SMS. The Zadarma app reads this before any outbound action; external automations (n8n, Retell, manual toggle) write to it.',
  icon: 'IconPhoneOff',
  defaultValue: false,
});
