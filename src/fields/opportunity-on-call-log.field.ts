import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import { CALL_LOG_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/objects/call-log.object';

import { CALL_LOGS_ON_OPPORTUNITY_FIELD_UNIVERSAL_IDENTIFIER } from './call-logs-on-opportunity.field';

export const OPPORTUNITY_ON_CALL_LOG_FIELD_UNIVERSAL_IDENTIFIER =
  '5fdf1221-7ed4-41c3-9690-8187d01e544b';

export default defineField({
  universalIdentifier: OPPORTUNITY_ON_CALL_LOG_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: CALL_LOG_OBJECT_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'opportunity',
  label: 'Opportunity',
  description:
    'The Opportunity (sales pipeline lead) this call is associated with. Populated externally by n8n / Twenty Workflows — the Zadarma webhook does not auto-link.',
  icon: 'IconTargetArrow',
  relationTargetObjectMetadataUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.opportunity.universalIdentifier,
  relationTargetFieldMetadataUniversalIdentifier:
    CALL_LOGS_ON_OPPORTUNITY_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    joinColumnName: 'opportunityId',
  },
});
