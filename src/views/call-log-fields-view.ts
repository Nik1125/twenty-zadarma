import { defineView, ViewType } from 'twenty-sdk/define';

import { CALL_LOG_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/objects/call-log.object';

// Default view that backs the FIELDS widget on the Call Log record page's
// Home tab. Twenty's page-layout save flow throws "Fields widget has no
// associated view" if the FIELDS widget's configuration.viewId points at a
// non-existent view, so the App must ship this view alongside the layout.
// FIELDS_WIDGET-typed views render no list — they only serve to hold the
// per-workspace overrides (which fields are visible, position, size) the
// operator sets via "Customize record page".
export const CALL_LOG_FIELDS_VIEW_UNIVERSAL_IDENTIFIER =
  '470d5980-191c-422d-b496-51fa51ffa83f';

export default defineView({
  universalIdentifier: CALL_LOG_FIELDS_VIEW_UNIVERSAL_IDENTIFIER,
  name: 'Call Log Fields',
  objectUniversalIdentifier: CALL_LOG_OBJECT_UNIVERSAL_IDENTIFIER,
  type: ViewType.FIELDS_WIDGET,
  icon: 'IconList',
});
