import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';

import { CALL_LOG_VIEW_UNIVERSAL_IDENTIFIER } from 'src/views/call-log-view';

export default defineNavigationMenuItem({
  universalIdentifier: '1687c5c7-fc22-4831-8a8c-ab60e03bf08a',
  name: 'Call logs',
  icon: 'IconPhone',
  position: 0,
  type: NavigationMenuItemType.VIEW,
  viewUniversalIdentifier: CALL_LOG_VIEW_UNIVERSAL_IDENTIFIER,
});
