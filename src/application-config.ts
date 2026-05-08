import { defineApplication } from 'twenty-sdk/define';

import { ZADARMA_SETTINGS_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER } from 'src/front-components/zadarma-settings.front-component';

import {
  ACTIVE_CALL_COOLDOWN_MINUTES_VARIABLE_UNIVERSAL_IDENTIFIER,
  AI_EXTENSIONS_VARIABLE_UNIVERSAL_IDENTIFIER,
  APP_DESCRIPTION,
  APP_DISPLAY_NAME,
  APPLICATION_UNIVERSAL_IDENTIFIER,
  CALL_ENRICHMENT_WINDOW_SECONDS_VARIABLE_UNIVERSAL_IDENTIFIER,
  DEFAULT_ROLE_UNIVERSAL_IDENTIFIER,
  DEFAULT_SENDER_DID_VARIABLE_UNIVERSAL_IDENTIFIER,
  ZADARMA_CABINET_TIMEZONE_VARIABLE_UNIVERSAL_IDENTIFIER,
  ZADARMA_SECRET_VARIABLE_UNIVERSAL_IDENTIFIER,
  ZADARMA_TRANSCRIPT_ENABLED_VARIABLE_UNIVERSAL_IDENTIFIER,
  ZADARMA_USER_KEY_VARIABLE_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  displayName: APP_DISPLAY_NAME,
  description: APP_DESCRIPTION,
  defaultRoleUniversalIdentifier: DEFAULT_ROLE_UNIVERSAL_IDENTIFIER,
  settingsCustomTabFrontComponentUniversalIdentifier:
    ZADARMA_SETTINGS_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  applicationVariables: {
    // Block 1 — Zadarma credentials (required for everything)
    ZADARMA_USER_KEY: {
      universalIdentifier: ZADARMA_USER_KEY_VARIABLE_UNIVERSAL_IDENTIFIER,
      description:
        'Zadarma API user key (https://my.zadarma.com/marketplace/#tab-apiKeys). Required.',
      isSecret: true,
    },
    ZADARMA_SECRET: {
      universalIdentifier: ZADARMA_SECRET_VARIABLE_UNIVERSAL_IDENTIFIER,
      description:
        'Zadarma API secret (paired with the user key). Required.',
      isSecret: true,
    },
    DEFAULT_SENDER_DID: {
      universalIdentifier: DEFAULT_SENDER_DID_VARIABLE_UNIVERSAL_IDENTIFIER,
      description:
        '[Manage in Custom tab] Default outbound DID. Format: E.164 without "+". Example: 48570000808.',
      value: '',
    },
    ZADARMA_TRANSCRIPT_ENABLED: {
      universalIdentifier: ZADARMA_TRANSCRIPT_ENABLED_VARIABLE_UNIVERSAL_IDENTIFIER,
      description:
        '[Manage in Custom tab] Save SPEECH_RECOGNITION transcripts into callLog.transcript. Accepts "true" or "false".',
      value: 'true',
    },
    // IANA timezone of your Zadarma cabinet (e.g. Europe/Warsaw, Europe/Berlin,
    // America/New_York). The PBX webhook delivers `call_start` as a wall-clock
    // string in this timezone with no offset; without the correct value, live
    // call timestamps cannot be converted to UTC. Empty default — must be set
    // before live call ingestion works correctly.
    ZADARMA_CABINET_TIMEZONE: {
      universalIdentifier: ZADARMA_CABINET_TIMEZONE_VARIABLE_UNIVERSAL_IDENTIFIER,
      description:
        '[Manage in Custom tab] IANA timezone of your Zadarma cabinet (Europe/Warsaw, Europe/Berlin, America/New_York, etc.). Required for accurate live call timestamps.',
      value: '',
    },
    // Window in minutes during which Person.activeCallStatus stays in
    // 'cooldown' after a call ends. Consumers (n8n / Retell / future
    // click-to-call) read this so a freshly-ended call is given time to
    // surface in the logs (transcript, recording, SMS) before the next
    // dialer attempts a follow-up. Lazy expiry — no background job clears
    // the field; consumers compare activeCallCooldownUntil against now.
    ACTIVE_CALL_COOLDOWN_MINUTES: {
      universalIdentifier: ACTIVE_CALL_COOLDOWN_MINUTES_VARIABLE_UNIVERSAL_IDENTIFIER,
      description:
        '[Manage in Custom tab] Minutes a Person stays in active-call cooldown after a call ends. Consumers (n8n / Retell / click-to-call) honour this to avoid back-to-back dials. Default: 5.',
      value: '5',
    },
    // Comma-separated list of internal extensions that route to AI agents
    // (e.g. "103,105"). Used by /zadarma/call-enrichment to narrow the
    // fuzzy callLog match — only OUT calls from these extensions are
    // candidates for AI enrichment, removing false matches with human
    // operator calls. Empty = no extension filter (less precise).
    AI_EXTENSIONS: {
      universalIdentifier: AI_EXTENSIONS_VARIABLE_UNIVERSAL_IDENTIFIER,
      description:
        '[Manage in Custom tab] Comma-separated internal extensions that route to AI agents (e.g. "103,105"). Helps /zadarma/call-enrichment filter AI calls from human operator calls. Empty = no extension filter.',
      value: '',
    },
    // Default time window (seconds) used by /zadarma/call-enrichment when
    // matching an inbound enrichment payload to an existing callLog by
    // start/end timestamp. Vendor adapters (Retell ~60s, Vapi ~30s) can
    // override per-request via match.windowSeconds. Range: 1-600.
    CALL_ENRICHMENT_WINDOW_SECONDS: {
      universalIdentifier: CALL_ENRICHMENT_WINDOW_SECONDS_VARIABLE_UNIVERSAL_IDENTIFIER,
      description:
        '[Manage in Custom tab] Default ± window (seconds) for fuzzy match in /zadarma/call-enrichment. Adapters can override per-request via match.windowSeconds. Default: 90, range 1-600.',
      value: '90',
    },
  },
});
