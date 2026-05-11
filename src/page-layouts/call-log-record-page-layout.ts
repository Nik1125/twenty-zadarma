import { definePageLayout, PageLayoutTabLayoutMode } from 'twenty-sdk/define';

import { CALL_LOG_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/objects/call-log.object';
import { CALL_LOG_FIELDS_VIEW_UNIVERSAL_IDENTIFIER } from 'src/views/call-log-fields-view';

// Twenty hides the "Customize record page" workspace UI for App-owned
// objects unless the App ships an explicit RECORD_PAGE layout for that
// object. The layout below registers four standard widget tabs
// (Timeline, Tasks, Notes, Files) — the same shape the reference
// `call-recording` App uses — which unlocks the Customize button so
// operators can rearrange tabs, add field blocks, or insert new
// widgets per their workflow.

export default definePageLayout({
  universalIdentifier: 'd8c8b930-e4e7-4cc0-95a1-36f574a11a43',
  name: 'Call Log Record Page',
  type: 'RECORD_PAGE',
  objectUniversalIdentifier: CALL_LOG_OBJECT_UNIVERSAL_IDENTIFIER,
  tabs: [
    {
      // Home tab — surfaces every callLog field via the built-in FIELDS
      // widget. Without it Twenty hides the default field-display panel
      // operators rely on (transcript / recording / summary blocks).
      // Standard Twenty objects use the same shape; see
      // twenty-server/.../page-layout-config/standard-person-page-layout.config.ts.
      universalIdentifier: 'adb3c4ee-6ec8-4efd-828a-f1683455677a',
      title: 'Home',
      position: 10,
      icon: 'IconHome',
      layoutMode: PageLayoutTabLayoutMode.VERTICAL_LIST,
      widgets: [
        {
          universalIdentifier: 'aa603a9a-d543-4341-bac3-2240edbd137d',
          title: 'Fields',
          type: 'FIELDS',
          gridPosition: { row: 0, column: 0, rowSpan: 12, columnSpan: 12 },
          position: { layoutMode: PageLayoutTabLayoutMode.VERTICAL_LIST, index: 0 },
          // Manifest configuration uses the universal form
          // (`viewUniversalIdentifier`) which the server resolves to a
          // viewId at install time. Plain `viewId: ...` in the manifest is
          // ignored — verified empirically on twenty-sdk 2.3 (the view
          // installs but the widget's configuration.viewId stays NULL,
          // which then trips "Fields widget has no associated view" on the
          // first operator customization save).
          configuration: {
            configurationType: 'FIELDS',
            viewUniversalIdentifier: CALL_LOG_FIELDS_VIEW_UNIVERSAL_IDENTIFIER,
          },
        },
      ],
    },
    {
      universalIdentifier: '379a9fef-5a50-45b4-8505-7ef551209919',
      title: 'Timeline',
      position: 100,
      icon: 'IconTimelineEvent',
      layoutMode: PageLayoutTabLayoutMode.CANVAS,
      widgets: [
        {
          universalIdentifier: '9c8128f5-798b-4f9e-8fa8-b4bc0edcc125',
          title: 'Timeline',
          type: 'TIMELINE',
          configuration: { configurationType: 'TIMELINE' },
        },
      ],
    },
    {
      universalIdentifier: 'd914ea68-81f3-46c3-96eb-1f5926fafc9a',
      title: 'Tasks',
      position: 200,
      icon: 'IconCheckbox',
      layoutMode: PageLayoutTabLayoutMode.CANVAS,
      widgets: [
        {
          universalIdentifier: '2e13bbdb-71f5-458e-b7d4-922818299728',
          title: 'Tasks',
          type: 'TASKS',
          configuration: { configurationType: 'TASKS' },
        },
      ],
    },
    {
      universalIdentifier: 'fce646fe-33ae-4504-b7d1-c99e015fd841',
      title: 'Notes',
      position: 300,
      icon: 'IconNotes',
      layoutMode: PageLayoutTabLayoutMode.CANVAS,
      widgets: [
        {
          universalIdentifier: 'fcab2bc5-0d56-4c5a-b03b-9f42c7843629',
          title: 'Notes',
          type: 'NOTES',
          configuration: { configurationType: 'NOTES' },
        },
      ],
    },
    {
      universalIdentifier: '1e28fcca-adbe-4f20-84a6-3035e69337d5',
      title: 'Files',
      position: 400,
      icon: 'IconPaperclip',
      layoutMode: PageLayoutTabLayoutMode.CANVAS,
      widgets: [
        {
          universalIdentifier: 'b61c0524-c442-439b-a8fb-1fa44cd3e42c',
          title: 'Files',
          type: 'FILES',
          configuration: { configurationType: 'FILES' },
        },
      ],
    },
  ],
});
