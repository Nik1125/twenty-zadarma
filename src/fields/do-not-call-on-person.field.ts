import {
  defineField,
  FieldType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

export const DO_NOT_CALL_FIELD_UNIVERSAL_IDENTIFIER =
  'aba1a998-9df5-4f8d-8a57-c2d8662e1274';

// Channel-specific call opt-out flag. The App never writes to this field —
// it only reads it before any outbound call action (future click-to-call
// button). External automations (n8n with LLM intent classification, Retell,
// manual UI toggle, native Twenty Workflow) own the write side. The SMS
// channel has a separate flag (doNotSms) because GDPR / Polish Art. 172 PT
// treats marketing channels independently — a contact may opt out of SMS
// while remaining reachable by call (or vice-versa).
export default defineField({
  universalIdentifier: DO_NOT_CALL_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.BOOLEAN,
  name: 'doNotCall',
  label: 'Do not call',
  description:
    'Marks this Person as opted-out of outbound calls. The Zadarma app reads this before any outbound call action; external automations (n8n, Retell, manual toggle) write to it. SMS opt-out is tracked separately on doNotSms.',
  icon: 'IconPhoneOff',
  defaultValue: false,
  // Existing Persons are migrated with NULL for this column (defaults only
  // apply to new rows). Consumers must treat null as "no opt-out recorded —
  // calling allowed".
  isNullable: true,
});
