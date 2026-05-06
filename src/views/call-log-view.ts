import { defineView } from 'twenty-sdk/define';

import {
  CALL_LOG_CALL_START_FIELD_UNIVERSAL_IDENTIFIER,
  CALL_LOG_CALL_TYPE_FIELD_UNIVERSAL_IDENTIFIER,
  CALL_LOG_CLIENT_NUMBER_FIELD_UNIVERSAL_IDENTIFIER,
  CALL_LOG_DISPOSITION_FIELD_UNIVERSAL_IDENTIFIER,
  CALL_LOG_DURATION_FIELD_UNIVERSAL_IDENTIFIER,
  CALL_LOG_NAME_FIELD_UNIVERSAL_IDENTIFIER,
  CALL_LOG_OBJECT_UNIVERSAL_IDENTIFIER,
  CALL_LOG_OUR_NUMBER_FIELD_UNIVERSAL_IDENTIFIER,
} from 'src/objects/call-log.object';

export const CALL_LOG_VIEW_UNIVERSAL_IDENTIFIER =
  'b4dcc600-bbf4-489b-817f-75ae73d2ef64';

export default defineView({
  universalIdentifier: CALL_LOG_VIEW_UNIVERSAL_IDENTIFIER,
  name: 'All calls',
  objectUniversalIdentifier: CALL_LOG_OBJECT_UNIVERSAL_IDENTIFIER,
  icon: 'IconPhone',
  position: 0,
  fields: [
    {
      universalIdentifier: 'c6080549-5882-4dbd-ac56-d33107eb28a9',
      fieldMetadataUniversalIdentifier: CALL_LOG_NAME_FIELD_UNIVERSAL_IDENTIFIER,
      isVisible: true,
      size: 12,
      position: 0,
    },
    {
      universalIdentifier: '198fa355-f001-4d11-8a03-1d26e6176cce',
      fieldMetadataUniversalIdentifier:
        CALL_LOG_CALL_TYPE_FIELD_UNIVERSAL_IDENTIFIER,
      isVisible: true,
      size: 8,
      position: 1,
    },
    {
      universalIdentifier: '9b80d915-c36f-4d46-a229-bf6d2177c5a9',
      fieldMetadataUniversalIdentifier:
        CALL_LOG_CALL_START_FIELD_UNIVERSAL_IDENTIFIER,
      isVisible: true,
      size: 12,
      position: 2,
    },
    {
      universalIdentifier: '332c938d-cc16-4d22-9278-3b1fa43898c8',
      fieldMetadataUniversalIdentifier:
        CALL_LOG_CLIENT_NUMBER_FIELD_UNIVERSAL_IDENTIFIER,
      isVisible: true,
      size: 12,
      position: 3,
    },
    {
      universalIdentifier: 'a7bb46d2-8f2b-46b7-80e6-7acc30be40fb',
      fieldMetadataUniversalIdentifier:
        CALL_LOG_OUR_NUMBER_FIELD_UNIVERSAL_IDENTIFIER,
      isVisible: true,
      size: 12,
      position: 4,
    },
    {
      universalIdentifier: '80daec7d-40cf-432f-acdc-3e3e1d111962',
      fieldMetadataUniversalIdentifier:
        CALL_LOG_DISPOSITION_FIELD_UNIVERSAL_IDENTIFIER,
      isVisible: true,
      size: 8,
      position: 5,
    },
    {
      universalIdentifier: 'a46cc534-2fbb-4ff6-a858-f26acda64bad',
      fieldMetadataUniversalIdentifier:
        CALL_LOG_DURATION_FIELD_UNIVERSAL_IDENTIFIER,
      isVisible: true,
      size: 8,
      position: 6,
    },
  ],
});
