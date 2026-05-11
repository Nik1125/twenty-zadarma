import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import { SMS_LOG_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/objects/sms-log.object';

import { SMS_LOGS_ON_OPPORTUNITY_FIELD_UNIVERSAL_IDENTIFIER } from './sms-logs-on-opportunity.field';

export const OPPORTUNITY_ON_SMS_LOG_FIELD_UNIVERSAL_IDENTIFIER =
  'ffada91a-9e37-456a-a099-61d8e5d82d1d';

export default defineField({
  universalIdentifier: OPPORTUNITY_ON_SMS_LOG_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: SMS_LOG_OBJECT_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'opportunity',
  label: 'Opportunity',
  description:
    'The Opportunity this SMS is associated with. Auto-attached to the most-recently-created Opportunity of the linked Person at insert time (mirror of the callLog.opportunity relation). Null when the Person has no opportunities.',
  icon: 'IconTargetArrow',
  relationTargetObjectMetadataUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.opportunity.universalIdentifier,
  relationTargetFieldMetadataUniversalIdentifier:
    SMS_LOGS_ON_OPPORTUNITY_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    joinColumnName: 'opportunityId',
  },
});
