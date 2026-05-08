import {
  definePageLayoutTab,
  PageLayoutTabLayoutMode,
} from 'twenty-sdk/define';

import { ZADARMA_PERSON_PANEL_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER } from 'src/front-components/zadarma-person-panel.front-component';

const STANDARD_PERSON_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER =
  '20202020-a102-4002-8002-ae0a1ea11002';

export default definePageLayoutTab({
  universalIdentifier: 'ab142a1d-1492-487e-836b-3a0b191111f3',
  pageLayoutUniversalIdentifier:
    STANDARD_PERSON_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  title: 'Zadarma',
  // Slot between standard Notes (40) and Files (50). Standard order
  // upstream: Home 10, Timeline 20, Tasks 30, Notes 40, Files 50,
  // Emails 60, Calendar 70 — see twenty-server's
  // standard-page-layout-tabs.template.ts.
  position: 45,
  icon: 'IconPhone',
  layoutMode: PageLayoutTabLayoutMode.CANVAS,
  widgets: [
    {
      universalIdentifier: '60c826c4-530d-473b-aa19-8453b84655d9',
      title: 'Zadarma',
      type: 'FRONT_COMPONENT',
      configuration: {
        configurationType: 'FRONT_COMPONENT',
        frontComponentUniversalIdentifier:
          ZADARMA_PERSON_PANEL_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
      },
    },
  ],
});
