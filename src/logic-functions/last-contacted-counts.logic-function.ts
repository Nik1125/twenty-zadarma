import { defineLogicFunction } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';
import { CoreApiClient } from 'twenty-client-sdk/core';

// Drives the "Last contact backfill" counters in Settings → Zadarma. Splits
// the People population into "have a lastContactedAt" vs "don't" so the user
// can decide whether running the recompute endpoint is worth it.

const handler = async (_event: RoutePayload<unknown>) => {
  const client = new CoreApiClient();

  const totalRes = (await client.query({
    people: {
      __args: { first: 0 },
      totalCount: true,
    },
  })) as { people?: { totalCount?: number } };

  const withoutRes = (await client.query({
    people: {
      __args: { filter: { lastContactedAt: { is: 'NULL' } }, first: 0 },
      totalCount: true,
    },
  })) as { people?: { totalCount?: number } };

  const total = totalRes.people?.totalCount ?? 0;
  const withoutTimestamp = withoutRes.people?.totalCount ?? 0;
  const withTimestamp = Math.max(total - withoutTimestamp, 0);

  return {
    ok: true,
    total,
    withTimestamp,
    withoutTimestamp,
  };
};

export default defineLogicFunction({
  universalIdentifier: '2211c876-c06e-4bc0-ab3f-f3b14bde1bd1',
  name: 'last-contacted-counts',
  description:
    'Returns how many Persons have / do not have a lastContactedAt timestamp. Used by the Settings panel to gate the recompute button.',
  timeoutSeconds: 10,
  handler,
  httpRouteTriggerSettings: {
    path: '/zadarma/last-contacted/counts',
    httpMethod: 'GET',
    isAuthRequired: true,
    forwardedRequestHeaders: ['authorization'],
  },
});
