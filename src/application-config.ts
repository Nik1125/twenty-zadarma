import { defineApplication } from 'twenty-sdk/define';

import { ZADARMA_SETTINGS_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER } from 'src/front-components/zadarma-settings.front-component';

import {
  ACTIVE_CALL_COOLDOWN_MINUTES_VARIABLE_UNIVERSAL_IDENTIFIER,
  AI_EXTENSIONS_VARIABLE_UNIVERSAL_IDENTIFIER,
  AI_RATE_CURRENCY_VARIABLE_UNIVERSAL_IDENTIFIER,
  AI_RATE_PER_MINUTE_VARIABLE_UNIVERSAL_IDENTIFIER,
  ZADARMA_AUTO_CREATE_PERSON_VARIABLE_UNIVERSAL_IDENTIFIER,
  TEAMSALE_BASE_URL_VARIABLE_UNIVERSAL_IDENTIFIER,
  APP_DESCRIPTION,
  APP_DISPLAY_NAME,
  APPLICATION_UNIVERSAL_IDENTIFIER,
  CALL_ENRICHMENT_WINDOW_SECONDS_VARIABLE_UNIVERSAL_IDENTIFIER,
  DEFAULT_ROLE_UNIVERSAL_IDENTIFIER,
  DEFAULT_SENDER_DID_VARIABLE_UNIVERSAL_IDENTIFIER,
  OUR_NUMBERS_VARIABLE_UNIVERSAL_IDENTIFIER,
  ZADARMA_CABINET_TIMEZONE_VARIABLE_UNIVERSAL_IDENTIFIER,
  ZADARMA_RATE_CURRENCY_VARIABLE_UNIVERSAL_IDENTIFIER,
  ZADARMA_RATE_PER_MINUTE_VARIABLE_UNIVERSAL_IDENTIFIER,
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
        '[Manage in Custom tab] [Legacy — prefer OUR_NUMBERS] Default outbound DID. Format: E.164 without "+". Example: 48570000808. Used as the sole entry when OUR_NUMBERS is empty.',
      value: '',
    },
    // Multi-DID workspaces: comma-separated list of E.164 numbers (without
    // "+") that we recognise as "ours". The first entry is used as the
    // default stamp on outbound callLog rows when Zadarma's stats payload
    // doesn't carry the actual leg DID. Future enhancement: per-row
    // classification using all entries (will require parser update).
    // Falls back to DEFAULT_SENDER_DID when empty for back-compat.
    OUR_NUMBERS: {
      universalIdentifier: OUR_NUMBERS_VARIABLE_UNIVERSAL_IDENTIFIER,
      description:
        '[Manage in Custom tab] Comma-separated list of all outbound DIDs the workspace owns (E.164 without "+"). Example: "48570000808,380501234567". First entry is used as default stamp on outbound calls. Empty = falls back to DEFAULT_SENDER_DID.',
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
    // Per-minute outbound call rate for Zadarma (HUMAN / UNKNOWN callerType).
    // Used at sync time and by /zadarma/recompute-costs to fill callLog.cost
    // from `(duration / 60) × rate`. Inbound calls always get cost=null
    // (the called party pays, not us). Empty rate or invalid number → cost
    // stays null (no inference, no surprise charges in dashboards).
    ZADARMA_RATE_PER_MINUTE: {
      universalIdentifier: ZADARMA_RATE_PER_MINUTE_VARIABLE_UNIVERSAL_IDENTIFIER,
      description:
        '[Manage in Custom tab] Per-minute outbound rate for Zadarma calls (HUMAN / UNKNOWN). Decimal in your tariff currency (e.g. "0.05" for 5 cents/min). Empty = cost not computed. Inbound calls are always null.',
      value: '',
    },
    ZADARMA_RATE_CURRENCY: {
      universalIdentifier: ZADARMA_RATE_CURRENCY_VARIABLE_UNIVERSAL_IDENTIFIER,
      description:
        '[Manage in Custom tab] ISO 4217 currency code for the Zadarma per-minute rate (USD, EUR, PLN, …). Required when ZADARMA_RATE_PER_MINUTE is set.',
      value: '',
    },
    AI_RATE_PER_MINUTE: {
      universalIdentifier: AI_RATE_PER_MINUTE_VARIABLE_UNIVERSAL_IDENTIFIER,
      description:
        '[Manage in Custom tab] Per-minute outbound rate for AI calls (callerType=AI). Decimal in your AI vendor tariff currency (e.g. "0.50"). Combines vendor minute price + telecom minute price into one figure.',
      value: '',
    },
    AI_RATE_CURRENCY: {
      universalIdentifier: AI_RATE_CURRENCY_VARIABLE_UNIVERSAL_IDENTIFIER,
      description:
        '[Manage in Custom tab] ISO 4217 currency code for the AI per-minute rate. Required when AI_RATE_PER_MINUTE is set.',
      value: '',
    },
    // Toggle for the inbound webhook auto-create-Person branch. When true,
    // a NOTIFY_END / NOTIFY_OUT_END event from a number that does not
    // match any Person in Twenty creates a Person on the spot
    // (firstName empty, lastName = clientNumber, primaryPhone = "+number").
    // Default off — most installations route inbound numbers through their
    // own n8n / FB-lead workflow before they reach the webhook.
    ZADARMA_AUTO_CREATE_PERSON: {
      universalIdentifier:
        ZADARMA_AUTO_CREATE_PERSON_VARIABLE_UNIVERSAL_IDENTIFIER,
      description:
        '[Manage in Custom tab] When "true", inbound calls from unknown numbers auto-create a Person in Twenty. Accepts "true" or "false". Default: false.',
      value: 'false',
    },
    // Subdomain prefix for the user's TeamSale (Zadarma free CRM)
    // workspace, e.g. "https://yourco.teamsale.com". Doubles as the
    // TeamSale-sync feature toggle: empty = sync disabled completely;
    // any value → sync-person-to-teamsale fires on Person.created and the
    // Settings backfill button is functional. The `Person.teamSaleLink`
    // LINKS field stores the full URL on each synced Person.
    TEAMSALE_BASE_URL: {
      universalIdentifier: TEAMSALE_BASE_URL_VARIABLE_UNIVERSAL_IDENTIFIER,
      description:
        '[Manage in Custom tab] Subdomain prefix for your TeamSale (Zadarma CRM) workspace, e.g. "https://yourco.teamsale.com". Empty = TeamSale-sync disabled.',
      value: '',
    },
  },
});
