import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import { SMS_LOG_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/objects/sms-log.object';

import { PERSON_ON_SMS_LOG_FIELD_UNIVERSAL_IDENTIFIER } from './person-on-sms-log.field';

export const SMS_LOGS_ON_PERSON_FIELD_UNIVERSAL_IDENTIFIER =
  '5c93706b-ff24-449c-83ac-fe10a5b0819a';

export default defineField({
  universalIdentifier: SMS_LOGS_ON_PERSON_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.RELATION,
  name: 'smsLogs',
  label: 'SMS logs',
  description: 'All Zadarma SMS messages linked to this Person',
  icon: 'IconMessage',
  relationTargetObjectMetadataUniversalIdentifier:
    SMS_LOG_OBJECT_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier:
    PERSON_ON_SMS_LOG_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
