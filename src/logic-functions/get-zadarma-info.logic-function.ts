import { defineLogicFunction } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';

import { signZadarmaRequest } from 'src/modules/zadarma/connector/sign-request';

type ZadarmaBalanceResponse = {
  status?: 'success' | 'error';
  balance?: number;
  currency?: string;
  message?: string;
};

type ZadarmaTariffResponse = {
  status?: 'success' | 'error';
  info?: {
    tariff_id?: number;
    tariff?: string;
  };
  message?: string;
};

type ZadarmaDirectNumbersResponse = {
  status?: 'success' | 'error';
  info?: Array<{
    number?: string;
    description?: string;
    status?: string;
    country?: string;
  }>;
  message?: string;
};

const callZadarma = async <T>(
  method: string,
  userKey: string,
  secret: string,
): Promise<T> => {
  const signed = signZadarmaRequest({
    method,
    params: {},
    userKey,
    secret,
    httpMethod: 'GET',
  });
  const response = await fetch(signed.url, { method: 'GET', headers: signed.headers });
  return (await response.json()) as T;
};

const handler = async (_event: RoutePayload<unknown>) => {
  const userKey = process.env.ZADARMA_USER_KEY;
  const secret = process.env.ZADARMA_SECRET;
  if (!userKey || !secret) {
    return {
      ok: false,
      error: 'ZADARMA_USER_KEY / ZADARMA_SECRET not set in Settings',
    };
  }

  // Run all three calls in parallel — failure of one shouldn't block the others.
  const [balanceResult, tariffResult, dialsResult] = await Promise.allSettled([
    callZadarma<ZadarmaBalanceResponse>('/v1/info/balance/', userKey, secret),
    callZadarma<ZadarmaTariffResponse>('/v1/tariff/', userKey, secret),
    callZadarma<ZadarmaDirectNumbersResponse>('/v1/direct_numbers/', userKey, secret),
  ]);

  const balanceData =
    balanceResult.status === 'fulfilled' ? balanceResult.value : null;
  const tariffData =
    tariffResult.status === 'fulfilled' ? tariffResult.value : null;
  const dialsData =
    dialsResult.status === 'fulfilled' ? dialsResult.value : null;

  if (balanceData?.status !== 'success') {
    return {
      ok: false,
      error:
        balanceData?.message ??
        (balanceResult.status === 'rejected'
          ? String(balanceResult.reason)
          : 'unknown error'),
    };
  }

  return {
    ok: true,
    balance: balanceData.balance,
    currency: balanceData.currency,
    tariff: tariffData?.info?.tariff,
    numbers: (dialsData?.info ?? [])
      .filter((n) => !!n.number)
      .map((n) => ({
        number: n.number,
        description: n.description ?? '',
        country: n.country ?? '',
        status: n.status ?? '',
      })),
  };
};

export default defineLogicFunction({
  universalIdentifier: 'acdd2327-e46f-46da-9acc-985b503a2674',
  name: 'get-zadarma-info',
  description:
    'Fetches Zadarma account info: balance, tariff, and the list of direct (incoming) numbers. Used by the Settings tab and the Person panel.',
  timeoutSeconds: 15,
  handler,
  httpRouteTriggerSettings: {
    path: '/zadarma/info',
    httpMethod: 'GET',
    isAuthRequired: true,
    forwardedRequestHeaders: ['authorization'],
  },
});
