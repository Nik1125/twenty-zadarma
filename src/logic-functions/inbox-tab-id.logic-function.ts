import { defineLogicFunction } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';
import { MetadataApiClient } from 'twenty-client-sdk/metadata';

import { resolveZadarmaTabId } from 'src/modules/zadarma/utils/resolve-zadarma-tab-id';

// GET /s/zadarma/inbox/tab-id — returns the installed id of the Person page's
// "Zadarma" tab so the inbox frontComponent can deep-link clicks to it
// (`/object/person/:id#<tabId>`). Fetched ONCE on inbox mount (the id is stable
// until the next App (re)install), not per poll. See resolve-zadarma-tab-id.ts
// for why this can't be a hardcoded constant.

const handler = async (_event: RoutePayload<unknown>) => {
  const tabId = await resolveZadarmaTabId(new MetadataApiClient());
  return { ok: true, tabId };
};

export default defineLogicFunction({
  universalIdentifier: 'ef0d5d6a-f65a-483d-a18b-05791cf31e9f',
  name: 'inbox-tab-id',
  description:
    'Returns the installed id of the Zadarma tab on the standard Person record page, for deep-linking from the inbox. The id is per-install (not portable), so it must be resolved at runtime.',
  timeoutSeconds: 10,
  handler,
  httpRouteTriggerSettings: {
    path: '/zadarma/inbox/tab-id',
    httpMethod: 'GET',
    isAuthRequired: true,
    forwardedRequestHeaders: ['authorization'],
  },
});
