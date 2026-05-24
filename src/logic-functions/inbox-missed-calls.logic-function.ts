import { defineLogicFunction } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';
import { CoreApiClient } from 'twenty-client-sdk/core';

import { computeMissedCalls } from 'src/modules/zadarma/utils/compute-missed-calls';

// GET /s/zadarma/inbox/missed-calls — the "Calls" tab of the Zadarma Inbox.
// Returns Persons with unresolved missed inbound calls, newest-first. Mirror of
// inbox.logic-function.ts (the SMS feed); the computation lives in the shared
// computeMissedCalls util. See [[project-sms-inbox-standalone-page]].

const DEFAULT_WINDOW_DAYS = 90;
const DEFAULT_MIN_DURATION_SECONDS = 10;

const clampDays = (raw: string | undefined): number => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_WINDOW_DAYS;
  return Math.min(Math.max(Math.floor(n), 1), 365);
};

const minDuration = (): number => {
  const n = Number(process.env.MISSED_CALL_MIN_DURATION_SECONDS);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_MIN_DURATION_SECONDS;
  return Math.floor(n);
};

const handler = async (event: RoutePayload<unknown>) => {
  const startedAt = Date.now();
  const days = clampDays(event.queryStringParameters?.days);
  const minDurationSeconds = minDuration();

  const { threads, scanned } = await computeMissedCalls(
    new CoreApiClient(),
    days,
    minDurationSeconds,
  );

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[inbox-missed-calls] days=${days} minDur=${minDurationSeconds} scanned=${scanned} threads=${threads.length} elapsedMs=${elapsedMs}`,
  );

  return {
    ok: true,
    threads,
    scanned,
    windowDays: days,
    minDurationSeconds,
    elapsedMs,
  };
};

export default defineLogicFunction({
  universalIdentifier: '9146dc1c-6350-4244-be2c-93c3c4028881',
  name: 'inbox-missed-calls',
  description:
    'Returns the "missed calls" feed for the Zadarma Inbox: Persons whose missed inbound calls are newer than their last outbound call, last real-answered inbound call, and their dismiss marker, sorted newest-first. Missed count derived from the call logs.',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    path: '/zadarma/inbox/missed-calls',
    httpMethod: 'GET',
    isAuthRequired: true,
    forwardedRequestHeaders: ['authorization'],
  },
});
