import { defineLogicFunction } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';
import { CoreApiClient } from 'twenty-client-sdk/core';

const handler = async (_event: RoutePayload<unknown>) => {
  const client = new CoreApiClient();

  const callsRes = (await client.query({
    callLogs: {
      __args: { filter: { personId: { is: 'NULL' } }, first: 0 },
      totalCount: true,
    },
  })) as { callLogs?: { totalCount?: number } };

  const smsRes = (await client.query({
    smsLogs: {
      __args: { filter: { personId: { is: 'NULL' } }, first: 0 },
      totalCount: true,
    },
  })) as { smsLogs?: { totalCount?: number } };

  return {
    ok: true,
    unlinkedCalls: callsRes.callLogs?.totalCount ?? 0,
    unlinkedSms: smsRes.smsLogs?.totalCount ?? 0,
  };
};

export default defineLogicFunction({
  universalIdentifier: 'f67eb63e-96cd-47a7-af04-e9b0e117af3e',
  name: 'orphan-counts',
  description:
    'Returns the count of callLog and smsLog records that have no Person link. Used by the Settings panel to show the orphan re-link button.',
  timeoutSeconds: 10,
  handler,
  httpRouteTriggerSettings: {
    path: '/zadarma/orphans/counts',
    httpMethod: 'GET',
    isAuthRequired: true,
    forwardedRequestHeaders: ['authorization'],
  },
});
