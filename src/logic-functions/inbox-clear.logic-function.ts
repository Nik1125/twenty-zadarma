import { defineLogicFunction } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';
import { CoreApiClient } from 'twenty-client-sdk/core';

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

  console.log(`[inbox-clear] personId=${personId} clearedAt=${clearedAt}`);
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
