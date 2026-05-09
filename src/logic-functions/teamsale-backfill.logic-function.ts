import { defineLogicFunction } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';
import { CoreApiClient } from 'twenty-client-sdk/core';

import { TEAMSALE_BACKFILL_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { buildTeamSalePayload } from 'src/modules/zadarma/utils/build-teamsale-payload';
import {
  composeTeamSaleUrl,
  createLead,
  lookupLeadByPhone,
  TeamSaleApiError,
  TeamSaleRateLimitError,
} from 'src/modules/zadarma/utils/teamsale-api';

// One-shot back-fill of `Person.teamSaleLink` for legacy rows that
// pre-date the TEAMSALE_BASE_URL toggle (or were created during a
// window when `sync-person-to-teamsale` failed silently). Two-layer
// filter: the Twenty query side filters by
// `teamSaleLink IS NULL AND primaryPhone IS NOT NULL` so already-linked
// rows are NEVER fetched — zero API calls spent on them. The handler
// also has an inner skip if the loaded row turns out to have a link
// (defence in depth against eventual consistency).
//
// Per-row throttle keeps us under Zadarma's 100 req/min global limit:
// each row may issue 1 lookup + 0/1 create = up to 2 Zadarma calls,
// plus 1 Twenty mutation. THROTTLE_MS = 1200 yields ≤50 rows/min ×
// ≤2 calls = ≤100 req/min — at the ceiling. 429 responses fall back
// to a longer pause via the rate-limit error's retryAfterSeconds.
//
// Body (all optional):
//   { limit?: number }   default 200, max 500. The handler ALSO has a
//                        soft 280s elapsed-budget so the 300s function
//                        timeout is never the proximate cause of failure.

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const PAGE_SIZE = 100;
const THROTTLE_MS = 1200;
const TIME_BUDGET_MS = 280_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

type BackfillBody = { limit?: number };

type PersonRow = {
  id: string;
  name?: {
    firstName?: string | null;
    lastName?: string | null;
  } | null;
  phones?: {
    primaryPhoneNumber?: string | null;
    primaryPhoneCallingCode?: string | null;
  } | null;
  teamSaleLink?: { primaryLinkUrl?: string | null } | null;
};

type BackfillResult = {
  ok: boolean;
  error?: string;
  scanned: number;
  synced: number;
  skipped: number;
  rateLimited: number;
  failed: number;
  hasMore: boolean;
  budgetExceeded: boolean;
  elapsedMs: number;
};

const handler = async (
  event: RoutePayload<BackfillBody>,
): Promise<BackfillResult> => {
  const startedAt = Date.now();

  const baseUrl = (process.env.TEAMSALE_BASE_URL ?? '').trim();
  if (!baseUrl) {
    return {
      ok: false,
      error: 'TEAMSALE_BASE_URL is not configured',
      scanned: 0,
      synced: 0,
      skipped: 0,
      rateLimited: 0,
      failed: 0,
      hasMore: false,
      budgetExceeded: false,
      elapsedMs: Date.now() - startedAt,
    };
  }

  const userKey = process.env.ZADARMA_USER_KEY;
  const secret = process.env.ZADARMA_SECRET;
  if (!userKey || !secret) {
    return {
      ok: false,
      error: 'ZADARMA_USER_KEY / ZADARMA_SECRET missing',
      scanned: 0,
      synced: 0,
      skipped: 0,
      rateLimited: 0,
      failed: 0,
      hasMore: false,
      budgetExceeded: false,
      elapsedMs: Date.now() - startedAt,
    };
  }

  const requestedLimit = event.body?.limit;
  const limit =
    typeof requestedLimit === 'number' && requestedLimit > 0
      ? Math.min(Math.floor(requestedLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;

  const client = new CoreApiClient();

  let scanned = 0;
  let synced = 0;
  let skipped = 0;
  let rateLimited = 0;
  let failed = 0;
  let hasMore = false;
  let budgetExceeded = false;
  let after: string | null | undefined = undefined;

  outer: while (scanned < limit) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      budgetExceeded = true;
      hasMore = true;
      break;
    }
    const remaining = limit - scanned;
    const pageSize = Math.min(PAGE_SIZE, remaining);

    // Filter at the query level — only Persons without teamSaleLink AND
    // with a primary phone reach the handler.
    const res = (await client.query({
      people: {
        __args: {
          filter: {
            and: [
              { teamSaleLink: { primaryLinkUrl: { is: 'NULL' } } },
              { phones: { primaryPhoneNumber: { is: 'NOT_NULL' } } },
            ],
          },
          orderBy: [{ createdAt: 'DescNullsLast' }],
          first: pageSize,
          ...(after ? { after } : {}),
        },
        edges: {
          node: {
            id: true,
            name: { firstName: true, lastName: true },
            phones: {
              primaryPhoneNumber: true,
              primaryPhoneCallingCode: true,
            },
            teamSaleLink: { primaryLinkUrl: true },
          },
        },
        pageInfo: { hasNextPage: true, endCursor: true },
      },
    })) as {
      people?: {
        edges?: Array<{ node: PersonRow }>;
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
      };
    };

    const edges = res.people?.edges ?? [];
    if (edges.length === 0) {
      hasMore = false;
      break;
    }
    scanned += edges.length;

    for (const { node } of edges) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        budgetExceeded = true;
        hasMore = true;
        break outer;
      }
      // Inner skip — defence in depth (race / eventual-consistency).
      if (node.teamSaleLink?.primaryLinkUrl) {
        skipped++;
        continue;
      }
      const payload = buildTeamSalePayload(
        { name: node.name ?? null, phones: node.phones ?? null },
        { leadSource: 'inbound_call' },
      );
      if (!payload) {
        skipped++;
        continue;
      }

      try {
        let leadId = await lookupLeadByPhone(payload.phone, {
          userKey,
          secret,
        });
        if (!leadId) {
          leadId = await createLead(payload, { userKey, secret });
        }
        await client.mutation({
          updatePerson: {
            __args: {
              id: node.id,
              data: {
                teamSaleLink: {
                  primaryLinkLabel: `Lead #${leadId}`,
                  primaryLinkUrl: composeTeamSaleUrl(baseUrl, leadId),
                },
              },
            },
            id: true,
          },
        });
        synced++;
      } catch (err) {
        if (err instanceof TeamSaleRateLimitError) {
          rateLimited++;
          // Honour the API's retry-after by sleeping; subsequent rows
          // continue afterwards. Whatever doesn't fit in the budget the
          // user can re-trigger by clicking again.
          const wait = Math.min(err.retryAfterSeconds * 1000, 30_000);
          console.warn(
            `[teamsale-backfill] rate-limited, sleeping ${wait}ms`,
          );
          await sleep(wait);
        } else if (err instanceof TeamSaleApiError) {
          failed++;
          console.warn(
            `[teamsale-backfill] api error personId=${node.id} status=${err.status} msg=${err.message}`,
          );
        } else {
          failed++;
          console.warn(
            `[teamsale-backfill] unexpected error personId=${node.id}:`,
            err,
          );
        }
      }

      await sleep(THROTTLE_MS);
    }

    hasMore = res.people?.pageInfo?.hasNextPage === true;
    after = res.people?.pageInfo?.endCursor;
    if (!after) hasMore = false;
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[teamsale-backfill] DONE scanned=${scanned} synced=${synced} skipped=${skipped} rateLimited=${rateLimited} failed=${failed} hasMore=${hasMore} budgetExceeded=${budgetExceeded} elapsed=${elapsedMs}ms`,
  );

  return {
    ok: true,
    scanned,
    synced,
    skipped,
    rateLimited,
    failed,
    hasMore,
    budgetExceeded,
    elapsedMs,
  };
};

export default defineLogicFunction({
  universalIdentifier: TEAMSALE_BACKFILL_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'teamsale-backfill',
  description:
    'One-shot back-fill of Person.teamSaleLink for legacy rows missing the link. Filter: teamSaleLink IS NULL AND primaryPhone IS NOT NULL — already-linked Persons are skipped at the query layer (zero API calls). Throttled at 1.2s/row to stay under Zadarma 100 req/min. Settings UI drains pagination until hasMore=false.',
  timeoutSeconds: 300,
  handler,
  httpRouteTriggerSettings: {
    path: '/zadarma/teamsale-backfill',
    httpMethod: 'POST',
    isAuthRequired: true,
    forwardedRequestHeaders: ['authorization'],
  },
});
