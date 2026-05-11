import { defineView, ViewType } from 'twenty-sdk/define';

import { SMS_LOG_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/objects/sms-log.object';

// Same pattern as call-log-fields-view.ts — backs the FIELDS widget on the
// SMS Log Home tab.
export const SMS_LOG_FIELDS_VIEW_UNIVERSAL_IDENTIFIER =
  'd90b736d-7195-444b-a8d0-7468f41ea6ad';

export default defineView({
  universalIdentifier: SMS_LOG_FIELDS_VIEW_UNIVERSAL_IDENTIFIER,
  name: 'SMS Log Fields',
  objectUniversalIdentifier: SMS_LOG_OBJECT_UNIVERSAL_IDENTIFIER,
  type: ViewType.FIELDS_WIDGET,
  icon: 'IconList',
});
