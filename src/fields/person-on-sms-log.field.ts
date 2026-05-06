import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import { SMS_LOG_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/objects/sms-log.object';

import { SMS_LOGS_ON_PERSON_FIELD_UNIVERSAL_IDENTIFIER } from './sms-logs-on-person.field';

export const PERSON_ON_SMS_LOG_FIELD_UNIVERSAL_IDENTIFIER =
  'adf7c53a-9978-4fd1-a1e2-dd3640ec27df';

export default defineField({
  universalIdentifier: PERSON_ON_SMS_LOG_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: SMS_LOG_OBJECT_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'person',
  label: 'Person',
  description: 'The Person this SMS is associated with (matched by clientNumber)',
  icon: 'IconUser',
  relationTargetObjectMetadataUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  relationTargetFieldMetadataUniversalIdentifier:
    SMS_LOGS_ON_PERSON_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    joinColumnName: 'personId',
  },
});
