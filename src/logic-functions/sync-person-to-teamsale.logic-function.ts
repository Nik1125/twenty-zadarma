import { defineLogicFunction } from 'twenty-sdk/define';
import {
  type DatabaseEventPayload,
  type ObjectRecordCreateEvent,
} from 'twenty-sdk/logic-function';
import { CoreApiClient } from 'twenty-client-sdk/core';

import { SYNC_PERSON_TO_TEAMSALE_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { buildTeamSalePayload } from 'src/modules/zadarma/utils/build-teamsale-payload';
import {
  composeTeamSaleUrl,
  createLead,
  lookupLeadByPhone,
  TeamSaleApiError,
  TeamSaleRateLimitError,
} from 'src/modules/zadarma/utils/teamsale-api';

// DB-event handler: on Twenty's `person.created`, ensure the Person has
// a backlink to TeamSale (Zadarma's free CRM). Behaviour:
//
//   1. Short-circuit if TEAMSALE_BASE_URL is empty (feature disabled).
//   2. Short-circuit if the Person already has teamSaleLink populated
//      (idempotent re-run on event redelivery — no double-creates).
//   3. Short-circuit if the Person has no primaryPhone (we cannot match
//      or create a TeamSale lead without one).
//   4. Lookup TeamSale by phone first (handles the case where Zadarma's
//      built-in auto-create-on-incoming-call already produced a lead, or
//      a previous run created one but the writeback to Twenty failed).
//   5. If no existing lead — POST /v1/zcrm/leads to create one.
//   6. Compose URL `<base>/leads/<id>` and write back to
//      Person.teamSaleLink as a LINKS field.
//
// All TeamSale errors are swallowed and logged (handler returns ok=true
// with reason). Rationale: this is a backup convenience, not a critical
// path. Failing the DB-event would surface red-banner errors in Twenty
// for every Person.create event — noisy and not actionable. The
// teamsale-backfill endpoint covers any gaps left by these silent
// failures.

type PersonAfter = {
  id?: string;
  name?: {
    firstName?: string | null;
    lastName?: string | null;
  } | null;
  phones?: {
    primaryPhoneNumber?: string | null;
    primaryPhoneCallingCode?: string | null;
    primaryPhoneCountryCode?: string | null;
  } | null;
  teamSaleLink?: {
    primaryLinkUrl?: string | null;
    primaryLinkLabel?: string | null;
  } | null;
};

type SyncResult = {
  ok: true;
  skipped?: string;
  action?: 'lookup_hit' | 'created';
  leadId?: string;
};

const handler = async (
  event: DatabaseEventPayload<ObjectRecordCreateEvent<PersonAfter>>,
): Promise<SyncResult> => {
  const personId = event.recordId;
  const after = event.properties?.after;
  if (!personId) return { ok: true, skipped: 'no_person_id' };

  const baseUrl = (process.env.TEAMSALE_BASE_URL ?? '').trim();
  if (!baseUrl) return { ok: true, skipped: 'teamsale_disabled' };

  const userKey = process.env.ZADARMA_USER_KEY;
  const secret = process.env.ZADARMA_SECRET;
  if (!userKey || !secret) {
    console.warn(
      '[sync-person-to-teamsale] ZADARMA_USER_KEY/SECRET missing — cannot sync',
    );
    return { ok: true, skipped: 'no_zadarma_credentials' };
  }

  // Idempotency: short-circuit if link already populated. The check uses
  // the event payload first (cheap) and skips the network round-trip on
  // re-deliveries.
  if (after?.teamSaleLink?.primaryLinkUrl) {
    return { ok: true, skipped: 'already_linked' };
  }

  const payload = buildTeamSalePayload(
    { name: after?.name ?? null, phones: after?.phones ?? null },
    { leadSource: 'inbound_call' },
  );
  if (!payload) {
    return { ok: true, skipped: 'no_phone' };
  }

  let leadId: string | null = null;
  let action: 'lookup_hit' | 'created' = 'created';

  try {
    leadId = await lookupLeadByPhone(payload.phone, { userKey, secret });
    if (leadId) {
      action = 'lookup_hit';
    } else {
      leadId = await createLead(payload, { userKey, secret });
      action = 'created';
    }
  } catch (err) {
    if (err instanceof TeamSaleRateLimitError) {
      console.warn(
        `[sync-person-to-teamsale] rate-limited (retry-after=${err.retryAfterSeconds}s) personId=${personId}`,
      );
      return { ok: true, skipped: 'rate_limited' };
    }
    if (err instanceof TeamSaleApiError) {
      console.warn(
        `[sync-person-to-teamsale] TeamSale API error (status=${err.status}) personId=${personId}: ${err.message}`,
      );
      return { ok: true, skipped: 'api_error' };
    }
    console.warn(
      `[sync-person-to-teamsale] unexpected error personId=${personId}:`,
      err,
    );
    return { ok: true, skipped: 'unexpected_error' };
  }

  const url = composeTeamSaleUrl(baseUrl, leadId);
  const client = new CoreApiClient();
  await client.mutation({
    updatePerson: {
      __args: {
        id: personId,
        data: {
          teamSaleLink: {
            primaryLinkLabel: `Lead #${leadId}`,
            primaryLinkUrl: url,
          },
        },
      },
      id: true,
    },
  });

  console.log(
    `[sync-person-to-teamsale] personId=${personId} action=${action} leadId=${leadId}`,
  );
  return { ok: true, action, leadId };
};

export default defineLogicFunction({
  universalIdentifier: SYNC_PERSON_TO_TEAMSALE_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'sync-person-to-teamsale',
  description:
    'On Person.created, ensures a backlink to the corresponding TeamSale (Zadarma free CRM) lead. Looks up by phone first; if no existing lead, creates one via POST /v1/zcrm/leads; writes the URL into Person.teamSaleLink. Idempotent. Disabled when TEAMSALE_BASE_URL is empty.',
  timeoutSeconds: 30,
  handler,
  databaseEventTriggerSettings: {
    eventName: 'person.created',
  },
});
