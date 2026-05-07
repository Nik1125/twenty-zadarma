import { defineApplication } from 'twenty-sdk/define';

import { ZADARMA_SETTINGS_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER } from 'src/front-components/zadarma-settings.front-component';

import {
  APP_DESCRIPTION,
  APP_DISPLAY_NAME,
  APPLICATION_UNIVERSAL_IDENTIFIER,
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
        '[Manage in Custom tab] Default outbound DID. Format: E.164 without "+". Example: 48573580808.',
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
  },
});
