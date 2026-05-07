import {
  defineField,
  FieldType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

export const LAST_CONTACTED_AT_FIELD_UNIVERSAL_IDENTIFIER =
  '36ba4982-fa3a-4abd-98df-4ac49c00130c';

// Auto-updated by DB-event triggers (update-last-contacted-on-call-out,
// update-last-contacted-on-sms-out) when a callLog or smsLog with
// direction=OUT and a Person link is created. Backfilled from history via
// the recompute-last-contacted endpoint exposed in Settings.
//
// Stores the timestamp of the most recent OUTBOUND touch only — inbound
// calls/SMS are intentionally excluded; this field answers "when did *we*
// last reach out", not "when was there any activity".
export default defineField({
  universalIdentifier: LAST_CONTACTED_AT_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.DATE_TIME,
  name: 'lastContactedAt',
  label: 'Last contacted at',
  description:
    'Timestamp of the most recent outbound call or SMS the Zadarma app sent to this Person. Auto-updated; backfillable from Settings → Zadarma.',
  icon: 'IconClock',
  isNullable: true,
});
