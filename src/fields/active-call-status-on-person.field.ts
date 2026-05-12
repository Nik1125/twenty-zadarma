import {
  defineField,
  FieldType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import { ACTIVE_CALL_STATUS_FIELD_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

// Live state-machine field. Written by the PBX webhook handler:
//   NOTIFY_START / NOTIFY_OUT_START / NOTIFY_INTERNAL → 'CALLING'
//   NOTIFY_END / NOTIFY_OUT_END                       → 'COOLDOWN' (+ activeCallCooldownUntil)
//   sweepStaleCooldowns / clearCooldownIfUnchanged    → 'IDLE'
// Consumers (n8n flows, Retell agents, future click-to-call button, additional
// human operators) read this to avoid concurrent dials. App never enforces
// the lock — it only publishes the signal.
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
  // Default = IDLE so newly-created Persons render with the explicit "free to
  // dial" label instead of an empty cell, and so consumers reading the field
  // never have to handle NULL as a fourth implicit state. Manually setting
  // the default in the workspace UI works once but is reset by every App
  // upgrade (manifest migration overrides workspace-level defaults), so the
  // value must live in the App schema. Existing rows with NULL stay NULL —
  // Postgres ALTER COLUMN SET DEFAULT does not back-fill — that's why we
  // also keep sweepStaleCooldowns() as the runtime self-heal.
  defaultValue: "'IDLE'",
  isNullable: true,
});
