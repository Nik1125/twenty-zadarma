import {
  defineNavigationMenuItem,
  NavigationMenuItemType,
} from 'twenty-sdk/define';

import { ZADARMA_INBOX_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER } from 'src/page-layouts/zadarma-inbox.page-layout';

// PROBE STUB — global left-sidebar item that opens the standalone inbox page.
// Uses type PAGE_LAYOUT (vs the VIEW type the call-log/sms-log items use) to
// point at a STANDALONE_PAGE rather than an object view.

export default defineNavigationMenuItem({
  universalIdentifier: 'b0664a31-a609-4caa-8768-a83ad4b0f856',
  name: 'Zadarma Inbox',
  icon: 'IconInbox',
  position: 2,
  type: NavigationMenuItemType.PAGE_LAYOUT,
  pageLayoutUniversalIdentifier: ZADARMA_INBOX_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
});
