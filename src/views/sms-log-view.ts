import { defineView } from 'twenty-sdk/define';

import {
  SMS_LOG_BODY_FIELD_UNIVERSAL_IDENTIFIER,
  SMS_LOG_CLIENT_NUMBER_FIELD_UNIVERSAL_IDENTIFIER,
  SMS_LOG_DIRECTION_FIELD_UNIVERSAL_IDENTIFIER,
  SMS_LOG_NAME_FIELD_UNIVERSAL_IDENTIFIER,
  SMS_LOG_OBJECT_UNIVERSAL_IDENTIFIER,
  SMS_LOG_OUR_NUMBER_FIELD_UNIVERSAL_IDENTIFIER,
  SMS_LOG_SENT_AT_FIELD_UNIVERSAL_IDENTIFIER,
  SMS_LOG_STATUS_FIELD_UNIVERSAL_IDENTIFIER,
} from 'src/objects/sms-log.object';

export const SMS_LOG_VIEW_UNIVERSAL_IDENTIFIER =
  'a6b13aa0-48ca-4e1a-a3e5-6ace04287efa';

export default defineView({
  universalIdentifier: SMS_LOG_VIEW_UNIVERSAL_IDENTIFIER,
  name: 'All SMS',
  objectUniversalIdentifier: SMS_LOG_OBJECT_UNIVERSAL_IDENTIFIER,
  icon: 'IconMessage',
  position: 0,
  fields: [
    {
      universalIdentifier: 'a76e37b2-104e-4e30-97d2-f6954fc40ce2',
      fieldMetadataUniversalIdentifier: SMS_LOG_NAME_FIELD_UNIVERSAL_IDENTIFIER,
      isVisible: true,
      size: 12,
      position: 0,
    },
    {
      universalIdentifier: '7d98f1e6-6535-46e7-9cd3-6dacb65f6940',
      fieldMetadataUniversalIdentifier:
        SMS_LOG_DIRECTION_FIELD_UNIVERSAL_IDENTIFIER,
      isVisible: true,
      size: 8,
      position: 1,
    },
    {
      universalIdentifier: '5c97a5d6-26df-4976-8832-abd7ccd881fd',
      fieldMetadataUniversalIdentifier:
        SMS_LOG_SENT_AT_FIELD_UNIVERSAL_IDENTIFIER,
      isVisible: true,
      size: 12,
      position: 2,
    },
    {
      universalIdentifier: 'ee6525e8-5b69-45c3-9c2f-97013a035851',
      fieldMetadataUniversalIdentifier:
        SMS_LOG_CLIENT_NUMBER_FIELD_UNIVERSAL_IDENTIFIER,
      isVisible: true,
      size: 12,
      position: 3,
    },
    {
      universalIdentifier: '941019f1-754a-4ae1-911e-e8663c1a8bfc',
      fieldMetadataUniversalIdentifier:
        SMS_LOG_OUR_NUMBER_FIELD_UNIVERSAL_IDENTIFIER,
      isVisible: true,
      size: 12,
      position: 4,
    },
    {
      universalIdentifier: 'dce4a2ac-911f-4b6f-9510-7a4abb468ebc',
      fieldMetadataUniversalIdentifier:
        SMS_LOG_STATUS_FIELD_UNIVERSAL_IDENTIFIER,
      isVisible: true,
      size: 8,
      position: 5,
    },
    {
      universalIdentifier: 'f40acd1c-41e0-4036-94a3-250f91706d84',
      fieldMetadataUniversalIdentifier: SMS_LOG_BODY_FIELD_UNIVERSAL_IDENTIFIER,
      isVisible: true,
      size: 24,
      position: 6,
    },
  ],
});
