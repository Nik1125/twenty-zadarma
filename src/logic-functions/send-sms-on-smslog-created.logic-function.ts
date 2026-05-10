import { defineLogicFunction } from 'twenty-sdk/define';
import {
  type DatabaseEventPayload,
  type ObjectRecordCreateEvent,
} from 'twenty-sdk/logic-function';
import { CoreApiClient } from 'twenty-client-sdk/core';

import { signZadarmaRequest } from 'src/modules/zadarma/connector/sign-request';
import { normalizePhone } from 'src/modules/zadarma/utils/normalize-phone';
import { parseRetryAfter } from 'src/modules/zadarma/utils/parse-retry-after';
import { updateLastContactedIfNewer } from 'src/modules/zadarma/utils/update-last-contacted';

// Trigger: when a manager creates an outbound smsLog through Twenty's standard
// UI (`+ New SMS log` on a Person card), this hook picks it up and actually
// fires the SMS through Zadarma's /v1/sms/send/, then updates the record with
// the result (status SUCCESS / FAILED, cost, error message).
//
// Why a hook instead of a frontComponent send button: Twenty 2.2 Remote DOM
// doesn't reliably propagate `<input>` value into the worker-side handler
// (target.value comes back empty), so we delegate text capture to Twenty's
// native record-create form where inputs work natively.
//
// To trigger this hook a record must be created with: direction='OUT',
// status='PENDING', body filled, clientNumber filled (E.164 without `+`),
// ourNumber filled (your verified Zadarma DID).

type SmsLogAfter = {
  id?: string;
  direction?: 'IN' | 'OUT' | null;
  status?: 'SUCCESS' | 'PENDING' | 'FAILED' | null;
  body?: string | null;
  clientNumber?: string | null;
  ourNumber?: string | null;
  personId?: string | null;
};

type ZadarmaSmsSendResponse = {
  status?: 'success' | 'error';
  cost?: number;
  currency?: string;
  message?: string;
};

const handler = async (
  event: DatabaseEventPayload<ObjectRecordCreateEvent<SmsLogAfter>>,
) => {
  const after = event.properties?.after;
  const smsLogId = event.recordId;
  if (!after || !smsLogId) return { ok: true, skipped: 'no record' };

  // Only handle records the manager wants us to send.
  if (after.direction !== 'OUT' || after.status !== 'PENDING') {
    return { ok: true, skipped: 'not OUT/PENDING' };
  }

  const number = normalizePhone(after.clientNumber);
  const ourNumber = normalizePhone(after.ourNumber);
  const message = after.body;

  const userKey = process.env.ZADARMA_USER_KEY;
  const secret = process.env.ZADARMA_SECRET;

  const client = new CoreApiClient();

  if (!number || !ourNumber || !message) {
    await client.mutation({
      updateSmsLog: {
        __args: {
          id: smsLogId,
          data: {
            status: 'FAILED',
            errorMessage: 'Missing required fields (clientNumber/ourNumber/body)',
          },
        },
        id: true,
      },
    });
    return { ok: false, error: 'missing fields' };
  }

  if (!userKey || !secret) {
    await client.mutation({
      updateSmsLog: {
        __args: {
          id: smsLogId,
          data: {
            status: 'FAILED',
            errorMessage: 'ZADARMA_USER_KEY/SECRET not configured',
          },
        },
        id: true,
      },
    });
    return { ok: false, error: 'config error' };
  }

  const signed = signZadarmaRequest({
    method: '/v1/sms/send/',
    params: { number, message, caller_id: ourNumber },
    userKey,
    secret,
  });

  const response = await fetch(signed.url, {
    method: 'POST',
    headers: signed.headers,
    body: signed.body,
  });

  // Zadarma 100 SMS/min cap. The smsLog row is already created (this trigger
  // fired off the standard UI's "+ New SMS log" form), so we cannot avoid it.
  // Mark it FAILED with a retry hint so the operator knows to wait and create
  // a fresh row (or rely on the caller's retry policy if going through the
  // /zadarma/send-sms endpoint which short-circuits before creating a row).
  if (response.status === 429) {
    const retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'));
    console.warn(
      `[send-sms-on-smslog-created] RATE_LIMITED smsLog=${smsLogId} retryAfter=${retryAfterSeconds}s`,
    );
    await client.mutation({
      updateSmsLog: {
        __args: {
          id: smsLogId,
          data: {
            status: 'FAILED',
            errorMessage: `Rate limited by Zadarma. Retry after ${retryAfterSeconds}s.`,
          },
        },
        id: true,
      },
    });
    return {
      ok: false,
      smsLogId,
      error: 'rate_limited',
      retryAfterSeconds,
    };
  }

  const data = (await response.json()) as ZadarmaSmsSendResponse;
  const isSuccess = data.status === 'success';

  await client.mutation({
    updateSmsLog: {
      __args: {
        id: smsLogId,
        data: {
          status: isSuccess ? 'SUCCESS' : 'FAILED',
          errorMessage: isSuccess ? null : (data.message ?? 'Send failed'),
          ...(isSuccess && data.cost !== undefined && data.currency
            ? {
                cost: {
                  amountMicros: Math.round(data.cost * 1_000_000),
                  currencyCode: data.currency,
                },
              }
            : {}),
        },
      },
      id: true,
    },
  });

  // Stamp Person.lastContactedAt for outbound touches we actually attempted —
  // success and failure both count, since we tried to reach the contact. We
  // do this inline here (rather than as a separate smsLog.created trigger)
  // because Twenty's migration appears to reject a second App-owned
  // subscriber on the same DB event; piggy-backing keeps the behaviour with
  // a single subscriber.
  if (after.personId) {
    await updateLastContactedIfNewer(
      client,
      after.personId,
      new Date().toISOString(),
    );
  }

  console.log(
    `[send-sms-on-smslog-created] smsLog=${smsLogId} number=${number} status=${data.status}`,
  );

  return {
    ok: isSuccess,
    smsLogId,
    zadarmaStatus: data.status,
    zadarmaMessage: data.message,
  };
};

export default defineLogicFunction({
  universalIdentifier: '0e9edd4a-fd23-49e3-85da-86bb706f0716',
  name: 'send-sms-on-smslog-created',
  description:
    'When an outbound smsLog with status=PENDING is created via Twenty UI, send the SMS through Zadarma and update the record with the result.',
  timeoutSeconds: 30,
  handler,
  databaseEventTriggerSettings: {
    eventName: 'smsLog.created',
  },
});
