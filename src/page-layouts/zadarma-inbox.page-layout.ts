import { definePageLayout, PageLayoutTabLayoutMode } from 'twenty-sdk/define';

import { ZADARMA_INBOX_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER } from 'src/front-components/zadarma-inbox.front-component';

// PROBE STUB — global standalone page (not bound to any object). Hosts a
// single FRONT_COMPONENT widget. Mirrors the github-connector dashboard
// shape (type: 'STANDALONE_PAGE'). Surfaced in the left nav via
// src/navigation-menu-items/zadarma-inbox.navigation-menu-item.ts.

export const ZADARMA_INBOX_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER =
  'f75713b8-23e3-4e3a-9a2d-efd5aa3bf321';

export default definePageLayout({
  universalIdentifier: ZADARMA_INBOX_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  name: 'Zadarma Inbox',
  type: 'STANDALONE_PAGE',
  tabs: [
    {
      universalIdentifier: '3b66569d-76c2-472f-ba8d-9d14698daa50',
      title: 'Inbox',
      position: 0,
      icon: 'IconInbox',
      layoutMode: PageLayoutTabLayoutMode.GRID,
      widgets: [
        {
          universalIdentifier: 'eac30fe0-ab1c-49ef-901d-34f385b87b92',
          title: 'Inbox',
          type: 'FRONT_COMPONENT',
          gridPosition: { row: 0, column: 0, rowSpan: 12, columnSpan: 12 },
          configuration: {
            configurationType: 'FRONT_COMPONENT',
            frontComponentUniversalIdentifier:
              ZADARMA_INBOX_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
          },
        },
      ],
    },
  ],
});
