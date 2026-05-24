import { defineLogicFunction } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';
import { CoreApiClient } from 'twenty-client-sdk/core';

import { computeUnansweredThreads } from 'src/modules/zadarma/utils/compute-unanswered-threads';

// GET /s/zadarma/inbox — messenger-style "unanswered SMS" feed for the global
// Zadarma Inbox standalone page. The actual computation lives in the shared
// computeUnansweredThreads util (also used by the event-driven inbox-icon
// signal). See [[project-sms-inbox-standalone-page]].

const DEFAULT_WINDOW_DAYS = 90;

const clampDays = (raw: string | undefined): number => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_WINDOW_DAYS;
  return Math.min(Math.max(Math.floor(n), 1), 365);
};

const handler = async (event: RoutePayload<unknown>) => {
  const startedAt = Date.now();
  const days = clampDays(event.queryStringParameters?.days);

  const { threads, scanned } = await computeUnansweredThreads(
    new CoreApiClient(),
    days,
  );

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[inbox] days=${days} scanned=${scanned} threads=${threads.length} elapsedMs=${elapsedMs}`,
  );

  return { ok: true, threads, scanned, windowDays: days, elapsedMs };
};

export default defineLogicFunction({
  universalIdentifier: '34283216-0978-478b-aaf6-e2ff95fc6cae',
  name: 'inbox',
  description:
    'Returns the "unanswered SMS" feed for the Zadarma Inbox: Persons whose inbound SMS are newer than their last outbound and their dismiss marker, sorted newest-first. Unread count derived from the logs.',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    path: '/zadarma/inbox',
    httpMethod: 'GET',
    isAuthRequired: true,
    forwardedRequestHeaders: ['authorization'],
  },
});
