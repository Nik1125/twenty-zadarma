import { defineLogicFunction } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';

// Zadarma sends a GET ?zd_echo=<token> when a webhook URL is first registered
// in their UI, expecting plain-text echo back. There's no signature on this
// request — it's a connectivity check. The signed POST handler runs at the
// same path; we only need this one for the one-time URL verification.
const handler = async (event: RoutePayload<unknown>) => {
  const echo = event.queryStringParameters?.zd_echo;
  if (echo) return echo;
  return { ok: true, hint: 'use POST for actual webhook deliveries' };
};

export default defineLogicFunction({
  universalIdentifier: '12a0981f-3a03-418b-b005-86c5dab60385',
  name: 'handle-zadarma-zd-echo',
  description: 'Responds to Zadarma URL-verification GET (zd_echo) at the PBX webhook path',
  timeoutSeconds: 5,
  handler,
  httpRouteTriggerSettings: {
    path: '/zadarma/pbx-webhook',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
