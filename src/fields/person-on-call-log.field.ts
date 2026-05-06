import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import { CALL_LOG_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/objects/call-log.object';

import { CALL_LOGS_ON_PERSON_FIELD_UNIVERSAL_IDENTIFIER } from './call-logs-on-person.field';

export const PERSON_ON_CALL_LOG_FIELD_UNIVERSAL_IDENTIFIER =
  'deb3dbc5-e678-4b86-b4ff-49f91f8e495f';

export default defineField({
  universalIdentifier: PERSON_ON_CALL_LOG_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: CALL_LOG_OBJECT_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'person',
  label: 'Person',
  description: 'The Person this call is associated with (matched by clientNumber)',
  icon: 'IconUser',
  relationTargetObjectMetadataUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  relationTargetFieldMetadataUniversalIdentifier:
    CALL_LOGS_ON_PERSON_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    joinColumnName: 'personId',
  },
});
