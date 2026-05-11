import { defineLogicFunction } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';
import { CoreApiClient } from 'twenty-client-sdk/core';

import { signZadarmaRequest } from 'src/modules/zadarma/connector/sign-request';
import { findLatestOpportunityIdForPerson } from 'src/modules/zadarma/utils/find-latest-opportunity-id';
import { findPersonIdByClientNumber } from 'src/modules/zadarma/utils/find-person-by-phone';
import {
  formatOptOutMessage,
  isOptedOutOfSms,
} from 'src/modules/zadarma/utils/is-opted-out-of-sms';
import { normalizePhone } from 'src/modules/zadarma/utils/normalize-phone';
import { parseRetryAfter } from 'src/modules/zadarma/utils/parse-retry-after';
import { parseSmsAnalyticsTags } from 'src/modules/zadarma/utils/parse-sms-analytics-tags';
import { updateLastContactedIfNewer } from 'src/modules/zadarma/utils/update-last-contacted';

type SendSmsRequest = {
  // Required: client phone in any format — normalized to E.164 without '+'.
  // Front-component posts as `to`; legacy callers use `number`.
  to?: string;
  number?: string;
  // Required: corporate sender number (must be verified in Zadarma cabinet).
  // Front-component posts as `from`; legacy callers use `ourNumber`.
  from?: string;
  ourNumber?: string;
  // Required: SMS body
  message?: string;
  // Optional: bind the resulting smsLog to a specific Person (skips lookup)
  personId?: string;
  // Optional: language hint for transliteration (e.g. 'ru', 'en')
  language?: string;
  // Optional analytics tags persisted on the resulting smsLog. Defaults
  // applied by parseSmsAnalyticsTags when absent.
  category?: string;
  source?: string;
  templateName?: string;
  campaignId?: string;
};

type ZadarmaSmsSendResponse = {
  status?: 'success' | 'error';
  messages?: number;
  cost?: number;
  currency?: string;
  message?: string;
};

const innerHandler = async (
  event: RoutePayload<SendSmsRequest>,
  debug: string[],
) => {
  debug.push(
    `[entry] body=${typeof event.body} preview=${typeof event.body === 'string' ? event.body.slice(0, 200) : JSON.stringify(event.body ?? {}).slice(0, 200)}`,
  );

  // Auth is enforced by Twenty's route-trigger via isAuthRequired=true. The
  // frontComponent worker sends Authorization: Bearer ${TWENTY_APP_ACCESS_TOKEN}
  // and route-trigger validates the JWT against the App's workspace before
  // invoking this handler — no URL-secret token gate needed.

  // Twenty's logic-function HTTP runtime delivers form-urlencoded bodies as
  // raw strings; JSON bodies arrive as parsed objects. Normalize to object.
  const rawBody = event.body;
  let body: SendSmsRequest;
  if (typeof rawBody === 'string') {
    debug.push('[body-parse] urlencoded string -> URLSearchParams');
    const params = new URLSearchParams(rawBody);
    body = {
      to: params.get('to') ?? undefined,
      from: params.get('from') ?? undefined,
      number: params.get('number') ?? undefined,
      ourNumber: params.get('ourNumber') ?? undefined,
      message: params.get('message') ?? undefined,
      personId: params.get('personId') ?? undefined,
      language: params.get('language') ?? undefined,
      category: params.get('category') ?? undefined,
      source: params.get('source') ?? undefined,
      templateName: params.get('templateName') ?? undefined,
      campaignId: params.get('campaignId') ?? undefined,
    };
  } else {
    debug.push('[body-parse] already-parsed object');
    body = (rawBody ?? {}) as SendSmsRequest;
  }

  // Accept both new (to/from) and legacy (number/ourNumber) field names.
  const number = normalizePhone(body.to ?? body.number);
  const ourNumber = normalizePhone(body.from ?? body.ourNumber);
  const message = body.message;
  debug.push(
    `[parsed] number=${number} ourNumber=${ourNumber} hasMessage=${!!message}`,
  );

  if (!number || !ourNumber || !message) {
    return {
      ok: false,
      error: 'missing required fields: to (or number), from (or ourNumber), message',
      received: {
        to: !!(body.to ?? body.number),
        from: !!(body.from ?? body.ourNumber),
        message: !!body.message,
      },
    };
  }

  // Resolve target Person up-front so we can short-circuit on opt-out before
  // contacting Zadarma. Caller may pass personId explicitly (UI knows the
  // context); otherwise look up by phone.
  const client = new CoreApiClient();
  let personId: string | null = body.personId ?? null;
  if (!personId) {
    personId = await findPersonIdByClientNumber(client, number);
  }

  // Defense-in-depth opt-out guard. The chat panel disables Send when
  // doNotSms is true, but anyone hitting this endpoint directly (n8n, curl,
  // future template-sender) must hit the same check server-side. Refusing
  // here means: no Zadarma API call, no smsLog row, no charge incurred.
  if (personId) {
    const personOptOut = (await client.query({
      person: {
        __args: { filter: { id: { eq: personId } } },
        doNotSms: true,
        doNotSmsAt: true,
        doNotSmsReason: true,
      },
    })) as {
      person: {
        doNotSms: boolean | null;
        doNotSmsAt: string | null;
        doNotSmsReason: string | null;
      } | null;
    };
    if (isOptedOutOfSms(personOptOut.person)) {
      debug.push('[opt-out] doNotSms=true, refusing to send');
      console.log(
        `[send-zadarma-sms] OPT_OUT number=${number} personId=${personId}`,
      );
      return {
        ok: false,
        error: 'OPT_OUT',
        message: formatOptOutMessage(personOptOut.person),
        personId,
        debug,
      };
    }
  }

  const userKey = process.env.ZADARMA_USER_KEY;
  const secret = process.env.ZADARMA_SECRET;
  debug.push(`[creds] userKey=${userKey ? 'set' : 'missing'} secret=${secret ? 'set' : 'missing'}`);
  if (!userKey || !secret) {
    console.error('[send-zadarma-sms] ZADARMA_USER_KEY/SECRET not configured');
    return { ok: false, error: 'configuration error: Zadarma credentials missing' };
  }

  const signed = signZadarmaRequest({
    method: '/v1/sms/send/',
    params: {
      number,
      message,
      caller_id: ourNumber,
      ...(body.language ? { language: body.language } : {}),
    },
    userKey,
    secret,
  });

  debug.push(`[sign] url=${signed.url}`);
  const response = await fetch(signed.url, {
    method: 'POST',
    headers: signed.headers,
    body: signed.body,
  });
  const responseText = await response.text();
  debug.push(`[zadarma] status=${response.status} body=${responseText.slice(0, 300)}`);

  // Zadarma 100 SMS/min cap. Surface the Retry-After to the caller (n8n,
  // Twenty Workflow, manual UI) so they know how long to back off. NOTE:
  // we deliberately DO NOT create an smsLog row here — leaving the failure
  // out of the log lets the caller retry cleanly without producing an
  // orphan FAILED row that would muddle dashboards.
  if (response.status === 429) {
    const retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'));
    console.warn(
      `[send-zadarma-sms] RATE_LIMITED number=${number} retryAfter=${retryAfterSeconds}s`,
    );
    return {
      ok: false,
      error: 'rate_limited',
      retryAfterSeconds,
      personId,
      debug,
    };
  }

  let data: ZadarmaSmsSendResponse;
  try {
    data = JSON.parse(responseText) as ZadarmaSmsSendResponse;
  } catch {
    return { ok: false, error: 'zadarma returned non-JSON', responseText, debug };
  }

  // Zadarma's send-sms response doesn't carry a unique message ID — we mint
  // one from timestamp+number so the smsLog is upsertable later if needed.
  const messageId = `sent-${Date.now()}-${number}`;

  const isSuccess = data.status === 'success';
  const sentAt = new Date().toISOString();

  const tags = parseSmsAnalyticsTags({
    category: body.category,
    source: body.source,
    templateName: body.templateName,
    campaignId: body.campaignId,
  });
  debug.push(
    `[tags] category=${tags.category} source=${tags.source} template=${tags.templateName ?? '-'} campaign=${tags.campaignId ?? '-'}`,
  );

  // Auto-attach to the Person's most-recently-created opportunity (if
  // any) so the SMS lands on the deal the operator is currently
  // working — same pattern callLog uses.
  const opportunityId = await findLatestOpportunityIdForPerson(client, personId);

  const created = (await client.mutation({
    createSmsLog: {
      __args: {
        data: {
          name: `OUT ${number}`,
          messageId,
          direction: 'OUT',
          status: isSuccess ? 'SUCCESS' : 'FAILED',
          errorMessage: isSuccess ? null : (data.message ?? 'Send failed'),
          sentAt,
          clientNumber: number,
          ourNumber,
          body: message,
          category: tags.category,
          source: tags.source,
          templateName: tags.templateName,
          campaignId: tags.campaignId,
          ...(isSuccess && data.cost !== undefined && data.currency
            ? {
                cost: {
                  amountMicros: Math.round(data.cost * 1_000_000),
                  currencyCode: data.currency,
                },
              }
            : {}),
          personId,
          ...(opportunityId ? { opportunityId } : {}),
        },
      },
      id: true,
    },
  })) as { createSmsLog?: { id: string } };

  // Stamp Person.lastContactedAt — done here (rather than via a smsLog.created
  // DB-event trigger) because Twenty's migration rejects a second App-owned
  // subscriber on the same event. The existing send-sms-on-smslog-created
  // trigger covers Path 2 (manual UI create); this covers Path 1 (front-
  // component / external API call going through this endpoint).
  if (personId) {
    await updateLastContactedIfNewer(client, personId, sentAt);
  }

  console.log(
    `[send-zadarma-sms] number=${number} status=${data.status} smsLog=${created.createSmsLog?.id} personId=${personId}`,
  );

  return {
    ok: isSuccess,
    smsLogId: created.createSmsLog?.id,
    personId,
    zadarmaStatus: data.status,
    zadarmaMessage: data.message,
    cost: data.cost,
    currency: data.currency,
    debug,
  };
};

const handler = async (event: RoutePayload<SendSmsRequest>) => {
  const debug: string[] = [];
  try {
    return await innerHandler(event, debug);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack =
      err instanceof Error && err.stack ? err.stack.split('\n').slice(0, 8) : undefined;
    console.error('[send-zadarma-sms] crashed:', err);
    return { ok: false, error: 'handler crashed', message, stack, debug };
  }
};

export default defineLogicFunction({
  universalIdentifier: 'd09e5b55-d52a-42f2-af22-d959303a1ebf',
  name: 'send-zadarma-sms',
  description:
    'Sends an SMS via Zadarma /v1/sms/send/ and writes a corresponding smsLog record (auto-linked to Person by phone).',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    // The frontComponent worker sends Authorization: Bearer
    // ${TWENTY_APP_ACCESS_TOKEN}; Twenty's route-trigger validates the JWT
    // against the App's workspace before invoking this handler. No URL token.
    path: '/zadarma/send-sms',
    httpMethod: 'POST',
    isAuthRequired: true,
    forwardedRequestHeaders: ['content-type', 'authorization'],
  },
});
