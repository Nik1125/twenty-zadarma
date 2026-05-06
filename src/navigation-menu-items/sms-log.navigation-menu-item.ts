import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';

import { SMS_LOG_VIEW_UNIVERSAL_IDENTIFIER } from 'src/views/sms-log-view';

export default defineNavigationMenuItem({
  universalIdentifier: '2382b74f-42f0-4a04-96a4-cdfe88f6aedd',
  name: 'SMS logs',
  icon: 'IconMessage',
  position: 1,
  type: NavigationMenuItemType.VIEW,
  viewUniversalIdentifier: SMS_LOG_VIEW_UNIVERSAL_IDENTIFIER,
});
