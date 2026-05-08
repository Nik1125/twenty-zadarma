import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import { CALL_LOG_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/objects/call-log.object';

import { OPPORTUNITY_ON_CALL_LOG_FIELD_UNIVERSAL_IDENTIFIER } from './opportunity-on-call-log.field';

export const CALL_LOGS_ON_OPPORTUNITY_FIELD_UNIVERSAL_IDENTIFIER =
  'c9c4aa1e-cb5f-44ce-ace5-e763d317673c';

export default defineField({
  universalIdentifier: CALL_LOGS_ON_OPPORTUNITY_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.opportunity.universalIdentifier,
  type: FieldType.RELATION,
  name: 'callLogs',
  label: 'Call logs',
  description: 'All Zadarma calls linked to this Opportunity',
  icon: 'IconPhone',
  relationTargetObjectMetadataUniversalIdentifier:
    CALL_LOG_OBJECT_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier:
    OPPORTUNITY_ON_CALL_LOG_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
