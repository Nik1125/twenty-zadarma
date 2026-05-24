import { defineLogicFunction } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';
import { CoreApiClient } from 'twenty-client-sdk/core';

// POST /s/zadarma/inbox/clear-calls — the Calls-tab "mark handled" (✓) button.
// Stamps Person.zadarmaCallsClearedAt = now() so that Person's current missed
// calls drop off the Calls feed without a callback (the operator decided no
// callback is owed). New missed calls after this time count from zero again.
//
// Unlike the SMS clear, this does NOT touch the inbox command icon: the bell
// signal is SMS-only by design — the missed-calls channel surfaces only as the
// in-page Calls-tab badge. See inbox-missed-calls.logic-function.ts for how the
// marker is consumed, and [[project-sms-inbox-standalone-page]] for the model.

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
      __args: { id: personId, data: { zadarmaCallsClearedAt: clearedAt } },
      id: true,
    },
  });

  console.log(`[inbox-clear-calls] personId=${personId} clearedAt=${clearedAt}`);
  return { ok: true, personId, clearedAt };
};

export default defineLogicFunction({
  universalIdentifier: '7e2ad550-dcae-4265-97bd-ec39820f529e',
  name: 'inbox-clear-calls',
  description:
    'Marks a Person\'s missed inbound calls as handled (no callback owed) by stamping zadarmaCallsClearedAt=now. Used by the Zadarma Inbox "Calls" tab ✓ button. Does not affect the SMS-only bell icon.',
  timeoutSeconds: 10,
  handler,
  httpRouteTriggerSettings: {
    path: '/zadarma/inbox/clear-calls',
    httpMethod: 'POST',
    isAuthRequired: true,
    forwardedRequestHeaders: ['content-type', 'authorization'],
  },
});
