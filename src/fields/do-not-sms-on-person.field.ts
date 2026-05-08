import {
  defineField,
  FieldType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

export const DO_NOT_SMS_FIELD_UNIVERSAL_IDENTIFIER =
  '60617810-8cf2-4f40-bc47-da1c5b8d3f07';

// Channel-specific SMS opt-out flag, mirror of doNotCall. The App never writes
// to this field — it only reads it inside send-zadarma-sms (and future
// send-template) before any outbound action. External automations (n8n with
// LLM intent classification, manual UI toggle, native Twenty Workflow) own
// the write side. This keeps language-specific phrase matching ("nie pisz",
// "не пишите", "stop", "REZYGNUJ") out of the open-source app — operators
// configure their own classifier to match their pipeline language and
// regulatory regime.
export default defineField({
  universalIdentifier: DO_NOT_SMS_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.BOOLEAN,
  name: 'doNotSms',
  label: 'Do not SMS',
  description:
    'Marks this Person as opted-out of outbound SMS. The Zadarma app reads this before sending and refuses with HTTP 409 OPT_OUT when set. External automations (n8n, manual toggle, Twenty Workflow) write to it.',
  icon: 'IconMessageOff',
  defaultValue: false,
  // Existing Persons are migrated with NULL for this column (defaults only
  // apply to new rows). Consumers must treat null as "no opt-out recorded —
  // sending allowed".
  isNullable: true,
});
