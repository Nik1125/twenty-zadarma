import { defineLogicFunction } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';
import { CoreApiClient } from 'twenty-client-sdk/core';
import { MetadataApiClient } from 'twenty-client-sdk/metadata';

import { refreshInboxIcon } from 'src/modules/zadarma/utils/inbox-icon';

// POST /s/zadarma/inbox/clear — the inbox "mark read" button. Stamps
// Person.zadarmaSmsClearedAt = now() so that Person's current inbound SMS drop
// off the unanswered feed without sending a reply (the "спасибо, no reply
// needed" case). New inbound after this time count from zero again. See
// inbox.logic-function.ts for how the marker is consumed, and
// [[project-sms-inbox-standalone-page]] for the model.

type ClearRequest = { personId?: string };

const handler = async (event: RoutePayload<ClearRequest>) => {
  const rawBody = event.body;
  let personId: string | undefined;
  if (typeof rawBody === 'string') {
    personId = new URLSearchParams(rawBody).get('personId') ?? undefined;
  } else {
    personId = ((rawBody ?? {}) as ClearRequest).personId;
  }

  if (!personId) {
    return { ok: false, error: 'missing required field: personId' };
  }

  const clearedAt = new Date().toISOString();
  const client = new CoreApiClient();
  await client.mutation({
    updatePerson: {
      __args: { id: personId, data: { zadarmaSmsClearedAt: clearedAt } },
      id: true,
    },
  });

  // Clearing one Person may drop the workspace's unanswered count to zero (or
  // not — others may remain), so recompute and update the command icon. Best
  // effort: a metadata hiccup must never fail the clear itself.
  // Clearing one Person may drop the workspace's unanswered count to zero (or
  // not — others may remain), so recompute and update the command icon. Best
  // effort: a metadata hiccup must never fail the clear itself.
  let iconChanged = false;
  try {
    iconChanged = await refreshInboxIcon(client, new MetadataApiClient());
  } catch (err) {
    console.error('[inbox-clear] icon refresh failed:', err);
  }

  console.log(
    `[inbox-clear] personId=${personId} clearedAt=${clearedAt} iconChanged=${iconChanged}`,
  );
  return { ok: true, personId, clearedAt };
};

export default defineLogicFunction({
  universalIdentifier: '00a99042-7e5d-4d04-b157-d764ff214116',
  name: 'inbox-clear',
  description:
    'Marks a Person\'s inbound SMS as handled (no reply needed) by stamping zadarmaSmsClearedAt=now. Used by the Zadarma Inbox "mark read" button.',
  timeoutSeconds: 10,
  handler,
  httpRouteTriggerSettings: {
    path: '/zadarma/inbox/clear',
    httpMethod: 'POST',
    isAuthRequired: true,
    forwardedRequestHeaders: ['content-type', 'authorization'],
  },
});
