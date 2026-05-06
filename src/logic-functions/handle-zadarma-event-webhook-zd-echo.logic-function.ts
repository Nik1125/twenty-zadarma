import { defineLogicFunction } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';

const handler = async (event: RoutePayload<unknown>) => {
  const echo = event.queryStringParameters?.zd_echo;
  if (echo) return echo;
  return { ok: true, hint: 'use POST for event webhooks' };
};

export default defineLogicFunction({
  universalIdentifier: '62c7a38e-75eb-4698-9677-657bc9876d2c',
  name: 'handle-zadarma-event-webhook-zd-echo',
  description: 'Responds to Zadarma URL-verification GET (zd_echo) at the events webhook path',
  timeoutSeconds: 5,
  handler,
  httpRouteTriggerSettings: {
    path: '/zadarma-event-webhook',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
