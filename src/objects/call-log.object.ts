import { defineObject, FieldType } from 'twenty-sdk/define';

export const CALL_LOG_OBJECT_UNIVERSAL_IDENTIFIER =
  '2c6371be-c070-48ba-aec1-bbf47ba7e1b9';

export const CALL_LOG_NAME_FIELD_UNIVERSAL_IDENTIFIER =
  'bba2c255-f23f-455d-bc7d-1d01669fa3ae';
export const CALL_LOG_PBX_CALL_ID_FIELD_UNIVERSAL_IDENTIFIER =
  'd28ec944-cd4b-49d5-8729-105be5893e14';
export const CALL_LOG_CALL_TYPE_FIELD_UNIVERSAL_IDENTIFIER =
  '30b28fa4-8d9b-4f04-b994-ccca148fd987';
export const CALL_LOG_CALL_START_FIELD_UNIVERSAL_IDENTIFIER =
  'f65466a5-723b-4104-bcda-e329a131cd72';
export const CALL_LOG_DURATION_FIELD_UNIVERSAL_IDENTIFIER =
  'd8bb097f-c04e-44dd-b8f1-98e3cbeab291';
export const CALL_LOG_DISPOSITION_FIELD_UNIVERSAL_IDENTIFIER =
  '830571b0-7ed4-4d10-906f-b7d75ab03286';
export const CALL_LOG_CLIENT_NUMBER_FIELD_UNIVERSAL_IDENTIFIER =
  '6e031c02-a6d6-4b58-af89-bb779d00906e';
export const CALL_LOG_OUR_NUMBER_FIELD_UNIVERSAL_IDENTIFIER =
  'fce32109-e876-46e0-922c-adba369061a4';
export const CALL_LOG_INTERNAL_EXTENSION_FIELD_UNIVERSAL_IDENTIFIER =
  'e24ecd15-4a55-43bd-b7d8-66890b8a5b56';
export const CALL_LOG_RECORDING_URL_FIELD_UNIVERSAL_IDENTIFIER =
  '11f98418-2825-4a82-982f-f2353d33dc53';
export const CALL_LOG_TRANSCRIPT_FIELD_UNIVERSAL_IDENTIFIER =
  '8316f7b0-c78e-4e0a-a6ce-767b9e911ebc';
export const CALL_LOG_SUMMARY_FIELD_UNIVERSAL_IDENTIFIER =
  '24e7ddee-a294-40cc-9ae9-f5ed8f4e993d';
export const CALL_LOG_COST_FIELD_UNIVERSAL_IDENTIFIER =
  'fee938b8-0ba0-419d-b66e-5f6eb3f4e227';
export const CALL_LOG_CALL_PATH_FIELD_UNIVERSAL_IDENTIFIER =
  '0d7986c5-10f2-47c8-93e2-e3d8c3d2e26f';
export const CALL_LOG_AI_VENDOR_FIELD_UNIVERSAL_IDENTIFIER =
  '7e2d8a91-3c4f-4b15-9e02-1f6a8d3e4c12';
export const CALL_LOG_AI_AGENT_NAME_FIELD_UNIVERSAL_IDENTIFIER =
  'b3f9c47e-2a18-4d65-8c91-5e7f3a9b2d04';
export const CALL_LOG_AI_SENTIMENT_FIELD_UNIVERSAL_IDENTIFIER =
  '4c8e1d23-9f56-4a72-b30e-6d8c5f4a1b97';
export const CALL_LOG_AI_SUCCESSFUL_FIELD_UNIVERSAL_IDENTIFIER =
  'a7d2f834-5b6c-4e91-9234-1f8e6c3d9b25';
export const CALL_LOG_AI_TRANSFERRED_FIELD_UNIVERSAL_IDENTIFIER =
  'e9b6f124-7d83-4c25-a614-3f5d9e2c8a07';
export const CALL_LOG_AI_COST_FIELD_UNIVERSAL_IDENTIFIER =
  '8d3a5b62-1f47-4e98-b2c5-7e9d4a6c3f81';
export const CALL_LOG_CORRELATION_ID_FIELD_UNIVERSAL_IDENTIFIER =
  '6b1e9c34-4d27-4f58-a803-2e9c8f5b7d61';
export const CALL_LOG_CALLER_TYPE_FIELD_UNIVERSAL_IDENTIFIER =
  'e97926fb-321f-456d-8350-cca6ae9e6530';
export const CALL_LOG_CALL_ID_FIELD_UNIVERSAL_IDENTIFIER =
  '2b1a7c93-4e58-4fb2-9de7-3a8c5f1d2e64';

export default defineObject({
  universalIdentifier: CALL_LOG_OBJECT_UNIVERSAL_IDENTIFIER,
  nameSingular: 'callLog',
  namePlural: 'callLogs',
  labelSingular: 'Call log',
  labelPlural: 'Call logs',
  description:
    'Record of a phone call (inbound or outbound) tracked through Zadarma',
  icon: 'IconPhone',
  labelIdentifierFieldMetadataUniversalIdentifier:
    CALL_LOG_NAME_FIELD_UNIVERSAL_IDENTIFIER,
  fields: [
    {
      universalIdentifier: CALL_LOG_NAME_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'name',
      label: 'Name',
      description:
        'Display name, e.g. "IN 48792010388 — 2026-04-28 08:21" (auto-generated)',
      icon: 'IconAbc',
    },
    {
      universalIdentifier: CALL_LOG_PBX_CALL_ID_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'pbxCallId',
      label: 'PBX Call ID',
      description: 'Unique Zadarma identifier (from webhook pbx_call_id or CSV call_id)',
      icon: 'IconHash',
      isUnique: true,
    },
    {
      universalIdentifier: CALL_LOG_CALL_ID_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'callId',
      label: 'Call ID (Asterisk)',
      description:
        'Asterisk channel id (Zadarma stats `call_id`). Required by /v1/speech_recognition/ to fetch a transcript for an already-completed call. Filled by sync-zadarma-calls; null on legacy rows synced before v0.17.0.',
      icon: 'IconHash',
      isNullable: true,
    },
    {
      universalIdentifier: CALL_LOG_CALL_TYPE_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.SELECT,
      name: 'callType',
      label: 'Type',
      description: 'Call direction',
      icon: 'IconArrowsLeftRight',
      options: [
        {
          id: '88c17be3-ac39-4c77-b65b-b3225c9dd215',
          value: 'IN',
          label: 'Inbound',
          position: 0,
          color: 'green',
        },
        {
          id: '58f0992c-14a3-4208-bf99-ebdf34c1ead4',
          value: 'OUT',
          label: 'Outbound',
          position: 1,
          color: 'blue',
        },
      ],
    },
    {
      universalIdentifier: CALL_LOG_CALL_START_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.DATE_TIME,
      name: 'callStart',
      label: 'Started at',
      description: 'When the call started (UTC)',
      icon: 'IconCalendar',
    },
    {
      universalIdentifier: CALL_LOG_DURATION_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.NUMBER,
      name: 'duration',
      label: 'Duration (s)',
      description: 'Call duration in seconds',
      icon: 'IconClock',
    },
    {
      universalIdentifier: CALL_LOG_DISPOSITION_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.SELECT,
      name: 'disposition',
      label: 'Disposition',
      description: 'Outcome of the call as reported by Zadarma',
      icon: 'IconStatusChange',
      options: [
        {
          id: 'ffdc0ff1-d398-4f4b-ba16-b24a3a285420',
          value: 'ANSWERED',
          label: 'Answered',
          position: 0,
          color: 'green',
        },
        {
          id: '844b9adf-7ee5-43b0-ae43-bfccf6f7905b',
          value: 'NO_ANSWER',
          label: 'No answer',
          position: 1,
          color: 'orange',
        },
        {
          id: 'aced0737-85ec-4e99-8044-1727f6416e88',
          value: 'BUSY',
          label: 'Busy',
          position: 2,
          color: 'yellow',
        },
        {
          id: '0ec2a649-3691-4268-a151-f80b388e92fd',
          value: 'CANCEL',
          label: 'Cancelled',
          position: 3,
          color: 'gray',
        },
        {
          id: '62aa47b9-22d5-4d8f-a41e-ba7d75703744',
          value: 'CALL_FAILED',
          label: 'Failed',
          position: 4,
          color: 'red',
        },
      ],
    },
    {
      universalIdentifier: CALL_LOG_CLIENT_NUMBER_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'clientNumber',
      label: 'Client number',
      description: "Client phone number in E.164 without '+' (e.g. 48792010388)",
      icon: 'IconPhone',
    },
    {
      universalIdentifier: CALL_LOG_OUR_NUMBER_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'ourNumber',
      label: 'Our number',
      description: "Corporate Zadarma number used for the call, E.164 without '+'",
      icon: 'IconPhoneOutgoing',
    },
    {
      universalIdentifier: CALL_LOG_INTERNAL_EXTENSION_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'internalExtension',
      label: 'Internal extension',
      description: "Zadarma PBX extension (e.g. '101', '102') if the call routed through one",
      icon: 'IconHash',
      isNullable: true,
    },
    {
      universalIdentifier: CALL_LOG_RECORDING_URL_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.LINKS,
      name: 'recording',
      label: 'Recording',
      description: 'Direct URL to the Zadarma recording (typically valid ~1 month)',
      icon: 'IconLink',
      isNullable: true,
    },
    {
      universalIdentifier: CALL_LOG_TRANSCRIPT_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.RICH_TEXT,
      name: 'transcript',
      label: 'Transcript',
      description: 'Full dialog transcript (filled by external automation, e.g. AssemblyAI via N8N)',
      icon: 'IconMessage',
      isNullable: true,
    },
    {
      universalIdentifier: CALL_LOG_SUMMARY_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.RICH_TEXT,
      name: 'summary',
      label: 'Summary',
      description: 'Short AI-generated summary of the conversation',
      icon: 'IconNotes',
      isNullable: true,
    },
    {
      universalIdentifier: CALL_LOG_COST_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.CURRENCY,
      name: 'cost',
      label: 'Cost',
      description: 'Cost of the call as reported by Zadarma',
      icon: 'IconCurrencyDollar',
      isNullable: true,
    },
    {
      universalIdentifier: CALL_LOG_CALL_PATH_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.RAW_JSON,
      name: 'callPath',
      label: 'Call path',
      description: 'Raw chain of call legs from CSV import (extensions, voicemail steps)',
      icon: 'IconRoute',
      isNullable: true,
    },
    {
      universalIdentifier: CALL_LOG_AI_VENDOR_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'aiVendor',
      label: 'AI vendor',
      description:
        'Vendor that produced the AI analysis on this call (e.g. "retell", "vapi"). Set by the n8n adapter via /zadarma/call-enrichment.',
      icon: 'IconRobot',
      isNullable: true,
    },
    {
      universalIdentifier: CALL_LOG_AI_AGENT_NAME_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'aiAgentName',
      label: 'AI agent',
      description:
        'Vendor-side agent identifier or display name (e.g. Retell agent_name). Useful for per-agent dashboards.',
      icon: 'IconUser',
      isNullable: true,
    },
    {
      universalIdentifier: CALL_LOG_AI_SENTIMENT_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.SELECT,
      name: 'aiSentiment',
      label: 'AI sentiment',
      description: 'User sentiment as classified by the AI vendor.',
      icon: 'IconMoodSmile',
      isNullable: true,
      options: [
        {
          id: 'd5f8a134-7b29-4e83-a651-9c4d8e2f3b07',
          value: 'POSITIVE',
          label: 'Positive',
          position: 0,
          color: 'green',
        },
        {
          id: 'b2e7c945-8a36-4d72-9c50-1f3d4e8b7a92',
          value: 'NEGATIVE',
          label: 'Negative',
          position: 1,
          color: 'red',
        },
        {
          id: 'a9c4f681-3e75-4b29-8d04-7f2c5a9e3b14',
          value: 'NEUTRAL',
          label: 'Neutral',
          position: 2,
          color: 'gray',
        },
        {
          id: 'f3b1d847-2c69-4a85-9e34-8d5c7f1b2a96',
          value: 'UNKNOWN',
          label: 'Unknown',
          position: 3,
          color: 'orange',
        },
      ],
    },
    {
      universalIdentifier: CALL_LOG_AI_SUCCESSFUL_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.BOOLEAN,
      name: 'aiSuccessful',
      label: 'AI successful',
      description:
        'Did the AI agent reach its goal in the call (vendor self-assessment)? Null if not analysed.',
      icon: 'IconCircleCheck',
      isNullable: true,
    },
    {
      universalIdentifier: CALL_LOG_AI_TRANSFERRED_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.BOOLEAN,
      name: 'aiTransferred',
      label: 'AI transferred',
      description:
        'True if the AI agent escalated the call to a human or another agent. Useful for AI-vs-human comparison dashboards.',
      icon: 'IconArrowsExchange',
      isNullable: true,
    },
    {
      universalIdentifier: CALL_LOG_AI_COST_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.CURRENCY,
      name: 'aiCost',
      label: 'AI cost',
      description:
        "AI vendor's billed cost for this call (LLM tokens, TTS, voice engine). Separate from telecom `cost` so total = cost + aiCost.",
      icon: 'IconBrain',
      isNullable: true,
    },
    {
      universalIdentifier: CALL_LOG_CORRELATION_ID_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'correlationId',
      label: 'Correlation ID',
      description:
        'Vendor-side call identifier (e.g. Retell call_id). Used as the idempotent join key for re-runs of /zadarma/call-enrichment. Vendor-raw debug data (tool calls, latency, transcripts) lives in a Note linked to this callLog via noteTargets, not on the callLog itself.',
      icon: 'IconLink',
      isNullable: true,
    },
    {
      universalIdentifier: CALL_LOG_CALLER_TYPE_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.SELECT,
      name: 'callerType',
      label: 'Caller type',
      description:
        'Who initiated the call: HUMAN if internalExtension is set and not in AI_EXTENSIONS, AI if in AI_EXTENSIONS, UNKNOWN otherwise. Auto-filled from the Zadarma webhook payload — orthogonal to aiAgentName (vendor-side identity).',
      icon: 'IconUserCircle',
      defaultValue: "'UNKNOWN'",
      options: [
        {
          id: '793c71f0-8f07-44dc-bf39-d39edea0463a',
          value: 'HUMAN',
          label: 'Human',
          position: 0,
          color: 'blue',
        },
        {
          id: '7abce9a6-f992-41be-8d60-fa7e21cc2011',
          value: 'AI',
          label: 'AI',
          position: 1,
          color: 'purple',
        },
        {
          id: '0ac627df-75ee-4bb3-9f39-96e4dc4c3b74',
          value: 'UNKNOWN',
          label: 'Unknown',
          position: 2,
          color: 'gray',
        },
      ],
    },
  ],
});
