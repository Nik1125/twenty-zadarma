import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import { CALL_LOG_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/objects/call-log.object';

import { PERSON_ON_CALL_LOG_FIELD_UNIVERSAL_IDENTIFIER } from './person-on-call-log.field';

export const CALL_LOGS_ON_PERSON_FIELD_UNIVERSAL_IDENTIFIER =
  '57ab8416-d085-46e6-8da4-090799190e4b';

export default defineField({
  universalIdentifier: CALL_LOGS_ON_PERSON_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.RELATION,
  name: 'callLogs',
  label: 'Call logs',
  description: 'All Zadarma calls linked to this Person',
  icon: 'IconPhone',
  relationTargetObjectMetadataUniversalIdentifier:
    CALL_LOG_OBJECT_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier:
    PERSON_ON_CALL_LOG_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
