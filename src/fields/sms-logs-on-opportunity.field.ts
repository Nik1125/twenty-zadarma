import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import { SMS_LOG_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/objects/sms-log.object';

import { OPPORTUNITY_ON_SMS_LOG_FIELD_UNIVERSAL_IDENTIFIER } from './opportunity-on-sms-log.field';

export const SMS_LOGS_ON_OPPORTUNITY_FIELD_UNIVERSAL_IDENTIFIER =
  '73cb72b2-513c-4edf-b443-2c0cdbf39a2a';

export default defineField({
  universalIdentifier: SMS_LOGS_ON_OPPORTUNITY_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.opportunity.universalIdentifier,
  type: FieldType.RELATION,
  name: 'smsLogs',
  label: 'SMS logs',
  description: 'All Zadarma SMS messages linked to this Opportunity',
  icon: 'IconMessage',
  relationTargetObjectMetadataUniversalIdentifier:
    SMS_LOG_OBJECT_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier:
    OPPORTUNITY_ON_SMS_LOG_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
