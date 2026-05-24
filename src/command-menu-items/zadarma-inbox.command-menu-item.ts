import { defineCommandMenuItem } from 'twenty-sdk/define';

import { ZADARMA_INBOX_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER } from 'src/front-components/zadarma-inbox.front-component';

// Top-level command-menu item = the GLOBAL pinned "Zadarma Inbox" button that
// opens the inbox feed in the right SIDE PANEL. Must be a standalone
// defineCommandMenuItem (NOT a nested `command` on defineFrontComponent): the
// SDK build only fills the manifest's top-level `commandMenuItems` array from
// these standalone defines; a nested command leaves that array empty and the
// server installs nothing (empirically why the person-panel nested command is
// absent on local + Coolify). availabilityType GLOBAL = available everywhere,
// and because the inbox fetches its own feed it renders populated without any
// selected record (unlike the person panel, which needs one).
export default defineCommandMenuItem({
  universalIdentifier: 'e9268af2-8f0f-4eb8-bd36-cc8f5c9f5c92',
  label: 'Zadarma Inbox',
  // shortLabel is REQUIRED for the pinned top-bar button to render its text
  // and for the "Hide label" toggle to be enabled — with shortLabel null the
  // button is icon-only and the toggle is locked (verified by diffing against
  // the working "Show Notification" app command, which sets shortLabel).
  shortLabel: 'Zadarma Inbox',
  icon: 'IconInbox',
  isPinned: true,
  availabilityType: 'GLOBAL',
  frontComponentUniversalIdentifier:
    ZADARMA_INBOX_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
});
