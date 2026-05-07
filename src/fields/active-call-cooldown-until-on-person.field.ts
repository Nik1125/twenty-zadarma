import {
  defineField,
  FieldType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import { ACTIVE_CALL_COOLDOWN_UNTIL_FIELD_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

// Companion to activeCallStatus. Set to (callEnd + ACTIVE_CALL_COOLDOWN_MINUTES)
// when the PBX webhook handler sees NOTIFY_END / NOTIFY_OUT_END for a Person.
// Cleared (set to null) when a new call starts. Consumers compare against now:
//   activeCallStatus === 'cooldown' && cooldownUntil <= now → effectively idle
// No background job clears the field — staleness is consumer-side, lazy.
export default defineField({
  universalIdentifier: ACTIVE_CALL_COOLDOWN_UNTIL_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.DATE_TIME,
  name: 'activeCallCooldownUntil',
  label: 'Active call cooldown until',
  description:
    'Timestamp until which a recently-ended call should hold off the next dialer. Paired with activeCallStatus. Consumers treat past timestamps as effectively idle.',
  icon: 'IconHourglass',
  isNullable: true,
});
