import { defineObject, FieldType } from 'twenty-sdk/define';

export const SMS_LOG_OBJECT_UNIVERSAL_IDENTIFIER =
  '24b27cc1-e056-43e2-8693-a6d3bbc7726d';

export const SMS_LOG_NAME_FIELD_UNIVERSAL_IDENTIFIER =
  '34fad76e-bdab-4cf9-a0b5-312151b9d327';
export const SMS_LOG_MESSAGE_ID_FIELD_UNIVERSAL_IDENTIFIER =
  'b09d110a-cb22-406a-a79e-713ab1b42c17';
export const SMS_LOG_DIRECTION_FIELD_UNIVERSAL_IDENTIFIER =
  '04533017-6e53-44e1-a4a3-fcf0aacee377';
export const SMS_LOG_STATUS_FIELD_UNIVERSAL_IDENTIFIER =
  'cb0c20bd-2838-416f-ac4a-12500a36b1fb';
export const SMS_LOG_ERROR_MESSAGE_FIELD_UNIVERSAL_IDENTIFIER =
  '6b077116-36c2-4ad0-8cad-cdb4f9319957';
export const SMS_LOG_SENT_AT_FIELD_UNIVERSAL_IDENTIFIER =
  '9f9788c2-e461-425f-b733-04541d3f54c5';
export const SMS_LOG_CLIENT_NUMBER_FIELD_UNIVERSAL_IDENTIFIER =
  '204c3d4c-3485-4354-905b-b68322d61de5';
export const SMS_LOG_OUR_NUMBER_FIELD_UNIVERSAL_IDENTIFIER =
  'ef934aa1-faf2-4fae-bdfc-707f101f03a7';
export const SMS_LOG_BODY_FIELD_UNIVERSAL_IDENTIFIER =
  '54a7e9bb-ceda-438e-a6b0-c16a52bf52c3';
export const SMS_LOG_COST_FIELD_UNIVERSAL_IDENTIFIER =
  '541372c9-2150-4738-abc7-1e01b8a15ed6';
export const SMS_LOG_CATEGORY_FIELD_UNIVERSAL_IDENTIFIER =
  'e04c3431-f82a-4fd9-96d8-5cebd449768b';
export const SMS_LOG_SOURCE_FIELD_UNIVERSAL_IDENTIFIER =
  '7d79bb1e-0c94-499d-b523-615594d5ed87';
export const SMS_LOG_TEMPLATE_NAME_FIELD_UNIVERSAL_IDENTIFIER =
  'dfa33e5c-64dd-4227-93a4-64d5f7e2745f';
export const SMS_LOG_CAMPAIGN_ID_FIELD_UNIVERSAL_IDENTIFIER =
  '589a8bac-a653-4d97-b669-00164906614d';

export default defineObject({
  universalIdentifier: SMS_LOG_OBJECT_UNIVERSAL_IDENTIFIER,
  nameSingular: 'smsLog',
  namePlural: 'smsLogs',
  labelSingular: 'SMS log',
  labelPlural: 'SMS logs',
  description:
    'Record of an SMS message (inbound or outbound) tracked through Zadarma',
  icon: 'IconMessage',
  labelIdentifierFieldMetadataUniversalIdentifier:
    SMS_LOG_NAME_FIELD_UNIVERSAL_IDENTIFIER,
  fields: [
    {
      universalIdentifier: SMS_LOG_NAME_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'name',
      label: 'Name',
      description:
        'Display name, e.g. "OUT 48792010388 — 2026-05-03 13:59" (auto-generated)',
      icon: 'IconAbc',
    },
    {
      universalIdentifier: SMS_LOG_MESSAGE_ID_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'messageId',
      label: 'Message ID',
      description: 'Unique Zadarma identifier (from webhook or JSON export)',
      icon: 'IconHash',
      isUnique: true,
    },
    {
      universalIdentifier: SMS_LOG_DIRECTION_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.SELECT,
      name: 'direction',
      label: 'Direction',
      description: 'SMS direction',
      icon: 'IconArrowsLeftRight',
      options: [
        {
          id: 'bd54bfeb-7a29-4f84-855f-a49060bf97ba',
          value: 'IN',
          label: 'Inbound',
          position: 0,
          color: 'green',
        },
        {
          id: '21e7575f-3424-46ec-b9c0-d7943b7fa0aa',
          value: 'OUT',
          label: 'Outbound',
          position: 1,
          color: 'blue',
        },
      ],
    },
    {
      universalIdentifier: SMS_LOG_STATUS_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.SELECT,
      name: 'status',
      label: 'Status',
      description: 'Delivery status as reported by Zadarma',
      icon: 'IconStatusChange',
      options: [
        {
          id: 'e5761bec-c50f-4bd0-9edb-90f5aad9bb60',
          value: 'SUCCESS',
          label: 'Success',
          position: 0,
          color: 'green',
        },
        {
          id: '59d1a513-6cb8-408b-b650-2ccda14169c5',
          value: 'PENDING',
          label: 'Pending',
          position: 1,
          color: 'yellow',
        },
        {
          id: 'f811a3f0-0544-4e20-a5e9-4d410da243f9',
          value: 'FAILED',
          label: 'Failed',
          position: 2,
          color: 'red',
        },
      ],
    },
    {
      universalIdentifier: SMS_LOG_ERROR_MESSAGE_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'errorMessage',
      label: 'Error message',
      description: 'Provider error description (e.g. "Accepted for delivery")',
      icon: 'IconAlertCircle',
      isNullable: true,
    },
    {
      universalIdentifier: SMS_LOG_SENT_AT_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.DATE_TIME,
      name: 'sentAt',
      label: 'Sent at',
      description: 'When the SMS was sent or received (UTC)',
      icon: 'IconCalendar',
    },
    {
      universalIdentifier: SMS_LOG_CLIENT_NUMBER_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'clientNumber',
      label: 'Client number',
      description: "Client phone number in E.164 without '+' (e.g. 48792010388)",
      icon: 'IconPhone',
    },
    {
      universalIdentifier: SMS_LOG_OUR_NUMBER_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'ourNumber',
      label: 'Our number',
      description: "Corporate Zadarma number used for the SMS, E.164 without '+'",
      icon: 'IconPhoneOutgoing',
    },
    {
      universalIdentifier: SMS_LOG_BODY_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'body',
      label: 'Body',
      description: 'SMS message text',
      icon: 'IconMessage',
    },
    {
      universalIdentifier: SMS_LOG_COST_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.CURRENCY,
      name: 'cost',
      label: 'Cost',
      description: 'Cost of the SMS as reported by Zadarma',
      icon: 'IconCurrencyDollar',
      isNullable: true,
    },
    {
      universalIdentifier: SMS_LOG_CATEGORY_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.SELECT,
      name: 'category',
      label: 'Category',
      description:
        'Coarse "what kind of message" tag for analytics. Populated by the caller on /send-sms; defaults to OTHER. Inbound rows also default to OTHER until an external classifier (e.g. n8n LLM) PATCHes a more meaningful value.',
      icon: 'IconCategory',
      defaultValue: "'OTHER'",
      options: [
        { id: '483bf407-968f-4c66-81fe-be292331e973', value: 'TRANSACTIONAL', label: 'Transactional', position: 0, color: 'blue' },
        { id: '579ca866-cc20-466f-bbbe-29b0747ed667', value: 'MARKETING', label: 'Marketing', position: 1, color: 'purple' },
        { id: 'dfe1c2c4-8949-4bd2-bfda-4b1c24ad0ae2', value: 'REMINDER', label: 'Reminder', position: 2, color: 'yellow' },
        { id: 'b2f3192e-28bc-4740-9281-aa35ed0d7b3c', value: 'FOLLOWUP', label: 'Follow-up', position: 3, color: 'orange' },
        { id: '696b22a3-023d-41b2-b0a5-f36340bfada2', value: 'CONFIRMATION', label: 'Confirmation', position: 4, color: 'green' },
        { id: 'fdd8bd29-afc2-4f20-86b1-f5946ccae090', value: 'OTHER', label: 'Other', position: 5, color: 'gray' },
      ],
    },
    {
      universalIdentifier: SMS_LOG_SOURCE_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.SELECT,
      name: 'source',
      label: 'Source',
      description:
        'Who triggered the send. Hard-coded by the chat panel (CHAT_PANEL) and by the inbound webhook (INBOUND); supplied explicitly by external callers (n8n, Twenty Workflow, curl). Substitute for createdBy, which always reports the App actor because /send-sms is the middleman.',
      icon: 'IconSend',
      defaultValue: "'OTHER'",
      options: [
        { id: '1fbc4f25-fba7-44da-ba2e-684483b91c50', value: 'CHAT_PANEL', label: 'Chat panel', position: 0, color: 'blue' },
        { id: 'b8de0334-de78-49b6-8249-537eda8a7c45', value: 'N8N', label: 'n8n', position: 1, color: 'purple' },
        { id: 'd2cf994a-4048-4fe9-aa19-8cad47f81cb2', value: 'TWENTY_WORKFLOW', label: 'Twenty Workflow', position: 2, color: 'turquoise' },
        { id: '559c6be4-c92b-4945-bb60-49d5f46b1c92', value: 'EXTERNAL_API', label: 'External API', position: 3, color: 'orange' },
        { id: '3efc05b8-1b5e-4b1b-bbde-af47f18460ca', value: 'INBOUND', label: 'Inbound', position: 4, color: 'green' },
        { id: '2d891ab3-ada5-484c-950a-09f02ce41cbf', value: 'OTHER', label: 'Other', position: 5, color: 'gray' },
      ],
    },
    {
      universalIdentifier: SMS_LOG_TEMPLATE_NAME_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'templateName',
      label: 'Template name',
      description:
        'Free-form caller-defined identifier of the template that produced the body (e.g. appointment_reminder_pl). Project-specific naming lives here; the app stays neutral.',
      icon: 'IconFileText',
      isNullable: true,
    },
    {
      universalIdentifier: SMS_LOG_CAMPAIGN_ID_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'campaignId',
      label: 'Campaign ID',
      description:
        'Free-form batch identifier for marketing rollouts (e.g. spring_2026_promo). Lets analytics group by campaign without a dedicated object.',
      icon: 'IconHash',
      isNullable: true,
    },
  ],
});
