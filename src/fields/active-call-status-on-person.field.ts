import {
  defineField,
  FieldType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import { ACTIVE_CALL_STATUS_FIELD_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

// Live state-machine field. Written by the PBX webhook handler:
//   NOTIFY_START / NOTIFY_OUT_START / NOTIFY_INTERNAL → 'CALLING'
//   NOTIFY_END / NOTIFY_OUT_END                       → 'COOLDOWN' (+ activeCallCooldownUntil)
// Consumers (n8n flows, Retell agents, future click-to-call button, additional
// human operators) read this to avoid concurrent dials. App never enforces
// the lock — it only publishes the signal. Existing Persons keep null which
// consumers must treat as 'IDLE' (no recorded call activity yet).
// Twenty constrains SELECT option `value` to UPPER_SNAKE_CASE — labels are
// shown in the UI, values are what consumers compare against.
export default defineField({
  universalIdentifier: ACTIVE_CALL_STATUS_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.SELECT,
  name: 'activeCallStatus',
  label: 'Active call status',
  description:
    'Live dial-lock signal. IDLE = free to dial; CALLING = a call is currently in progress; COOLDOWN = a call ended recently, check activeCallCooldownUntil. Consumers read; the Zadarma app writes via PBX webhooks.',
  icon: 'IconPhoneCall',
  options: [
    { position: 0, label: 'Idle', value: 'IDLE', color: 'gray' },
    { position: 1, label: 'Calling', value: 'CALLING', color: 'green' },
    { position: 2, label: 'Cooldown', value: 'COOLDOWN', color: 'yellow' },
  ],
  // No defaultValue — both existing and new Persons start at NULL. Consumers
  // (n8n / Retell / future click-to-call button) treat NULL as effectively
  // 'IDLE'. The webhook handler writes 'CALLING' / 'COOLDOWN' explicitly.
  isNullable: true,
});
