import { definePageLayout, PageLayoutTabLayoutMode } from 'twenty-sdk/define';

import { SMS_LOG_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/objects/sms-log.object';

// Same pattern as call-log-record-page-layout.ts: ships an explicit
// RECORD_PAGE so Twenty surfaces the "Customize record page" workspace
// UI for the App-owned smsLog object. Three tabs only — SMS records do
// not carry attachments, so the Files tab is omitted.

export default definePageLayout({
  universalIdentifier: 'c9af19b0-19a3-4196-bf65-5bf8443d5b09',
  name: 'SMS Log Record Page',
  type: 'RECORD_PAGE',
  objectUniversalIdentifier: SMS_LOG_OBJECT_UNIVERSAL_IDENTIFIER,
  tabs: [
    {
      // Home tab — same Fields-widget pattern as Call Log Record Page.
      universalIdentifier: '7965dca5-871e-4d22-9b0c-2cff6f916efb',
      title: 'Home',
      position: 10,
      icon: 'IconHome',
      layoutMode: PageLayoutTabLayoutMode.VERTICAL_LIST,
      widgets: [
        {
          universalIdentifier: '476c1a92-fc08-48b3-b46e-32c325180972',
          title: 'Fields',
          type: 'FIELDS',
          gridPosition: { row: 0, column: 0, rowSpan: 12, columnSpan: 12 },
          position: { layoutMode: PageLayoutTabLayoutMode.VERTICAL_LIST, index: 0 },
          configuration: { configurationType: 'FIELDS' },
        },
      ],
    },
    {
      universalIdentifier: '830f3c95-c389-49e7-81a6-25d565025498',
      title: 'Timeline',
      position: 100,
      icon: 'IconTimelineEvent',
      layoutMode: PageLayoutTabLayoutMode.CANVAS,
      widgets: [
        {
          universalIdentifier: '42dbd643-c769-4bc0-b585-0075e67bfac5',
          title: 'Timeline',
          type: 'TIMELINE',
          configuration: { configurationType: 'TIMELINE' },
        },
      ],
    },
    {
      universalIdentifier: '7943f485-3834-4f97-a16b-30c7b57ffa6b',
      title: 'Tasks',
      position: 200,
      icon: 'IconCheckbox',
      layoutMode: PageLayoutTabLayoutMode.CANVAS,
      widgets: [
        {
          universalIdentifier: 'e1f11086-e4ec-4918-8b79-d8a489fd3c8a',
          title: 'Tasks',
          type: 'TASKS',
          configuration: { configurationType: 'TASKS' },
        },
      ],
    },
    {
      universalIdentifier: '33bbda76-76f1-458a-8d20-9a3c8464182e',
      title: 'Notes',
      position: 300,
      icon: 'IconNotes',
      layoutMode: PageLayoutTabLayoutMode.CANVAS,
      widgets: [
        {
          universalIdentifier: '0bf968d1-9733-4a34-aebe-06c7acf52b05',
          title: 'Notes',
          type: 'NOTES',
          configuration: { configurationType: 'NOTES' },
        },
      ],
    },
  ],
});
