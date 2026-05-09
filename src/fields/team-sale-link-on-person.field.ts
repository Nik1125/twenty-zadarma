import {
  defineField,
  FieldType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import { TEAMSALE_LINK_FIELD_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

// Backlink to the corresponding lead in TeamSale (Zadarma's free CRM,
// formerly ZCRM / Teamsale.com). When `TEAMSALE_BASE_URL` is configured,
// the App auto-fills this field on every newly-created Person:
//   - On `person.created` Twenty fires sync-person-to-teamsale
//   - The handler does GET /v1/zcrm/leads?phone=<E.164> first; if found,
//     uses that lead id; otherwise POST /v1/zcrm/leads creates a new one
//   - The handler then writes back the URL composed as
//     `<TEAMSALE_BASE_URL>/leads/<lead_id>` plus a label "Lead #<id>"
//
// Idempotency: the sync handler short-circuits if `primaryLinkUrl` is
// already populated, so re-runs are cheap. Use the Settings → Zadarma
// "Sync existing Persons to TeamSale" button to back-fill orphan rows
// (those that existed before TEAMSALE_BASE_URL was configured).
export default defineField({
  universalIdentifier: TEAMSALE_LINK_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.LINKS,
  name: 'teamSaleLink',
  label: 'TeamSale lead',
  description:
    'Backlink to the corresponding lead in Zadarma TeamSale CRM. Auto-filled by sync-person-to-teamsale when TEAMSALE_BASE_URL is configured. Click to open the TeamSale record in a new tab. Empty = not yet synced.',
  icon: 'IconExternalLink',
  isNullable: true,
});
