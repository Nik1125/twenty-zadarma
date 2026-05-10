import { defineLogicFunction } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';
import { CoreApiClient } from 'twenty-client-sdk/core';

import { SYNC_ZADARMA_CALLS_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { signZadarmaRequest } from 'src/modules/zadarma/connector/sign-request';
import {
  computeCallCostFromRate,
  parseCostRatesFromEnv,
} from 'src/modules/zadarma/utils/compute-call-cost-from-rate';
import { deriveCallerType } from 'src/modules/zadarma/utils/derive-caller-type';
import {
  enrichCallLogs,
  type EnrichInput,
  type EnrichResult,
} from 'src/modules/zadarma/utils/enrich-call-logs';
import { parseAiExtensions } from 'src/modules/zadarma/utils/parse-ai-extensions';
import { resolveOurNumbers } from 'src/modules/zadarma/utils/parse-our-numbers';
import {
  groupAndNormalizeStats,
  type ZadarmaPbxStatRow,
} from 'src/modules/zadarma/utils/parse-zadarma-pbx-stats';
import { utcIsoToTzWallClock } from 'src/modules/zadarma/utils/utc-iso-to-tz-wall-clock';

// Live calls sync. Fetches `/v1/statistics/pbx/?version=2` for a UTC range,
// dedupes against existing `callLog.pbxCallId`, inserts new rows. Inline
// auto-link by phone-suffix mirrors the rescan-orphans logic so the user
// doesn't need a second click to attach Persons.
//
// Body (all optional):
//   { fromIso?: string, toIso?: string }
// Both omitted → incremental: window = (max(callLog.callStart) - 1h) → now.
// If no rows exist yet → last 7 days.
// Both provided → custom range, validated to <= 365 days.

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;
const MAX_RANGE_DAYS = 365;
const CHUNK_DAYS = 31;
const CHUNK_SLEEP_MS = 22_000;
const MUTATION_BATCH = 10;
const PHONE_SUFFIX_LEN = 9;
const PERSON_PAGE_SIZE = 200;

type SyncBody = { fromIso?: string; toIso?: string };

type ZadarmaPbxStatsResponse = {
  status?: 'success' | 'error';
  stats?: ZadarmaPbxStatRow[];
  message?: string;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const isIsoString = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value));

const phoneKey = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, '');
  if (!digits) return null;
  return digits.length >= PHONE_SUFFIX_LEN
    ? digits.slice(-PHONE_SUFFIX_LEN)
    : digits;
};

const isUniqueConstraintError = (err: unknown): boolean => {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : JSON.stringify(err ?? '');
  const lower = msg.toLowerCase();
  return (
    lower.includes('unique') ||
    lower.includes('duplicate') ||
    lower.includes('pbxcallid')
  );
};

const findLatestCallStart = async (
  client: CoreApiClient,
): Promise<string | null> => {
  const res = (await client.query({
    callLogs: {
      __args: {
        filter: { callStart: { is: 'NOT_NULL' } },
        orderBy: [{ callStart: 'DescNullsLast' }],
        first: 1,
      },
      edges: { node: { callStart: true } },
    },
  })) as {
    callLogs?: {
      edges?: Array<{ node: { callStart?: string | null } }>;
    };
  };
  return res.callLogs?.edges?.[0]?.node?.callStart ?? null;
};

const buildPersonsByPhoneSuffix = async (
  client: CoreApiClient,
): Promise<Map<string, string>> => {
  const map = new Map<string, string>();
  let after: string | null | undefined = undefined;
  let hasMore = true;
  while (hasMore) {
    const res = (await client.query({
      people: {
        __args: { first: PERSON_PAGE_SIZE, ...(after ? { after } : {}) },
        edges: {
          node: {
            id: true,
            phones: {
              primaryPhoneNumber: true,
              additionalPhones: true,
            },
          },
        },
        pageInfo: { hasNextPage: true, endCursor: true },
      },
    })) as {
      people?: {
        edges?: Array<{
          node: {
            id: string;
            phones?: {
              primaryPhoneNumber?: string | null;
              additionalPhones?: Array<{ number?: string | null }> | null;
            } | null;
          };
        }>;
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
      };
    };
    const edges = res.people?.edges ?? [];
    for (const { node } of edges) {
      const primary = phoneKey(node.phones?.primaryPhoneNumber);
      if (primary && !map.has(primary)) map.set(primary, node.id);
      const extra = node.phones?.additionalPhones;
      if (Array.isArray(extra)) {
        for (const ap of extra) {
          const key = phoneKey(ap?.number);
          if (key && !map.has(key)) map.set(key, node.id);
        }
      }
    }
    hasMore = res.people?.pageInfo?.hasNextPage === true;
    after = res.people?.pageInfo?.endCursor;
    if (!after) hasMore = false;
  }
  return map;
};

// Twenty filter rule: one operator per field. We chunk pbxCallIds into batches
// and query each via `pbxCallId: { in: [...] }`. Cost: O(parsedRows / 200)
// queries — typically 1-2 pages per sync run. Catches dups regardless of
// callStart presence (legacy null-callStart rows included).
const PBX_CALL_ID_QUERY_CHUNK = 200;

const fetchExistingPbxCallIds = async (
  client: CoreApiClient,
  pbxCallIds: string[],
): Promise<Set<string>> => {
  const set = new Set<string>();
  for (let i = 0; i < pbxCallIds.length; i += PBX_CALL_ID_QUERY_CHUNK) {
    const slice = pbxCallIds.slice(i, i + PBX_CALL_ID_QUERY_CHUNK);
    const res = (await client.query({
      callLogs: {
        __args: {
          filter: { pbxCallId: { in: slice } },
          first: PBX_CALL_ID_QUERY_CHUNK,
        },
        edges: { node: { pbxCallId: true } },
      },
    })) as {
      callLogs?: { edges?: Array<{ node: { pbxCallId?: string | null } }> };
    };
    for (const { node } of res.callLogs?.edges ?? []) {
      if (node.pbxCallId) set.add(node.pbxCallId);
    }
  }
  return set;
};

const formatChunks = (
  fromMs: number,
  toMs: number,
  tz: string,
): Array<{ start: string; end: string }> => {
  const stepMs = CHUNK_DAYS * ONE_DAY_MS;
  const chunks: Array<{ start: string; end: string }> = [];
  for (let cur = fromMs; cur < toMs; cur += stepMs) {
    const next = Math.min(cur + stepMs - 1000, toMs);
    chunks.push({
      start: utcIsoToTzWallClock(new Date(cur).toISOString(), tz),
      end: utcIsoToTzWallClock(new Date(next).toISOString(), tz),
    });
  }
  return chunks;
};

type FetchOk = { ok: true; stats: ZadarmaPbxStatRow[] };
type FetchErr = { ok: false; error: string };

const fetchOneChunk = async (
  userKey: string,
  secret: string,
  start: string,
  end: string,
): Promise<FetchOk | FetchErr> => {
  const signed = signZadarmaRequest({
    method: '/v1/statistics/pbx/',
    params: { start, end, version: '2' },
    userKey,
    secret,
    httpMethod: 'GET',
  });
  const res = await fetch(signed.url, { method: 'GET', headers: signed.headers });
  const text = await res.text();
  if (res.status === 429) {
    return { ok: false, error: 'rate-limited (429); retry in a minute' };
  }
  if (res.status !== 200) {
    return {
      ok: false,
      error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
    };
  }
  let json: ZadarmaPbxStatsResponse;
  try {
    json = JSON.parse(text) as ZadarmaPbxStatsResponse;
  } catch {
    return { ok: false, error: `Non-JSON response: ${text.slice(0, 200)}` };
  }
  if (json.status !== 'success') {
    return { ok: false, error: `API error: ${json.message ?? 'unknown'}` };
  }
  return { ok: true, stats: json.stats ?? [] };
};

type SyncResult = {
  ok: boolean;
  error?: string;
  windowFrom?: string;
  windowTo?: string;
  fetched?: number;
  created?: number;
  skippedDup?: number;
  linked?: number;
  failed?: number;
  costed?: number;
  elapsedMs?: number;
  enrichment?: EnrichResult;
};

// Soft budget for in-sync enrichment. Sync's logic-function timeout is 300s;
// we reserve ~120s for enrichment (≈50 rows at 2.4s/row including throttle).
// For larger newly-created batches the remaining rows surface as
// `enrichment.budgetExceeded` and the user clicks "Enrich missing recordings"
// in Settings to finish them via the dedicated backfill endpoint.
const ENRICHMENT_BUDGET_MS = 120_000;

const handler = async (
  event: RoutePayload<SyncBody>,
): Promise<SyncResult> => {
  const startedAt = Date.now();
  const userKey = process.env.ZADARMA_USER_KEY;
  const secret = process.env.ZADARMA_SECRET;
  const cabinetTz = (process.env.ZADARMA_CABINET_TIMEZONE ?? '').trim();
  // Multi-DID resolution: OUR_NUMBERS first (any number of comma-separated
  // entries), legacy DEFAULT_SENDER_DID as fallback. First entry is used as
  // the default stamp on outbound rows when Zadarma stats don't carry the
  // actual leg DID — same behaviour as before for single-DID workspaces.
  const ourNumbers = resolveOurNumbers({
    OUR_NUMBERS: process.env.OUR_NUMBERS,
    DEFAULT_SENDER_DID: process.env.DEFAULT_SENDER_DID,
  });
  const ourNumber = ourNumbers[0] ?? '';
  const rates = parseCostRatesFromEnv({
    ZADARMA_RATE_PER_MINUTE: process.env.ZADARMA_RATE_PER_MINUTE,
    ZADARMA_RATE_CURRENCY: process.env.ZADARMA_RATE_CURRENCY,
    AI_RATE_PER_MINUTE: process.env.AI_RATE_PER_MINUTE,
    AI_RATE_CURRENCY: process.env.AI_RATE_CURRENCY,
  });
  const aiExtensions = parseAiExtensions(process.env.AI_EXTENSIONS);

  if (!userKey || !secret) {
    return { ok: false, error: 'ZADARMA_USER_KEY / ZADARMA_SECRET not set in Settings' };
  }
  if (!cabinetTz) {
    return {
      ok: false,
      error:
        'ZADARMA_CABINET_TIMEZONE not set. Configure it in Settings → Zadarma so callstart values can be converted to UTC.',
    };
  }

  const body: SyncBody = event.body ?? {};
  const { fromIso, toIso } = body;
  const eitherProvided = fromIso !== undefined || toIso !== undefined;
  if (eitherProvided && !(isIsoString(fromIso) && isIsoString(toIso))) {
    return {
      ok: false,
      error: 'fromIso and toIso must both be valid ISO 8601 UTC strings (or both omitted for incremental sync)',
    };
  }

  const client = new CoreApiClient();

  let fromMs: number;
  let toMs: number;
  if (fromIso && toIso) {
    fromMs = Date.parse(fromIso);
    toMs = Date.parse(toIso);
  } else {
    const latest = await findLatestCallStart(client);
    toMs = Date.now();
    fromMs = latest
      ? Date.parse(latest) - ONE_HOUR_MS
      : toMs - SEVEN_DAYS_MS;
  }

  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    return { ok: false, error: 'Invalid window: end must be after start' };
  }
  const rangeDays = (toMs - fromMs) / ONE_DAY_MS;
  if (rangeDays > MAX_RANGE_DAYS) {
    return {
      ok: false,
      error: `Range ${rangeDays.toFixed(1)} days exceeds maximum ${MAX_RANGE_DAYS} days. Narrow the window.`,
    };
  }

  const windowFrom = new Date(fromMs).toISOString();
  const windowTo = new Date(toMs).toISOString();

  const chunks = formatChunks(fromMs, toMs, cabinetTz);

  // Aggregate stats across chunks.
  const aggregated: ZadarmaPbxStatRow[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const { start, end } = chunks[i];
    console.log(
      `[sync-zadarma-calls] chunk ${i + 1}/${chunks.length} ${start} → ${end}`,
    );
    const result = await fetchOneChunk(userKey, secret, start, end);
    if (!result.ok) {
      return {
        ok: false,
        error: `chunk ${i + 1}/${chunks.length}: ${result.error}`,
        windowFrom,
        windowTo,
      };
    }
    aggregated.push(...result.stats);
    console.log(
      `[sync-zadarma-calls] chunk ${i + 1} stats=${result.stats.length} aggregated=${aggregated.length}`,
    );
    if (i < chunks.length - 1) await sleep(CHUNK_SLEEP_MS);
  }

  const { rows: parsed } = groupAndNormalizeStats(aggregated, {
    ourNumber,
    cabinetTimezone: cabinetTz,
  });

  if (parsed.length === 0) {
    return {
      ok: true,
      windowFrom,
      windowTo,
      fetched: 0,
      created: 0,
      skippedDup: 0,
      linked: 0,
      failed: 0,
      elapsedMs: Date.now() - startedAt,
    };
  }

  const existingIds = await fetchExistingPbxCallIds(
    client,
    parsed.map((r) => r.pbxCallId),
  );
  const toCreate = parsed.filter((r) => !existingIds.has(r.pbxCallId));
  const skippedDup = parsed.length - toCreate.length;

  let linked = 0;
  const personMap =
    toCreate.length > 0 ? await buildPersonsByPhoneSuffix(client) : new Map<string, string>();

  let created = 0;
  let failed = 0;
  let dupRace = 0;
  let costed = 0;
  const createdForEnrichment: EnrichInput[] = [];

  for (let i = 0; i < toCreate.length; i += MUTATION_BATCH) {
    const wave = toCreate.slice(i, i + MUTATION_BATCH);
    const results = await Promise.allSettled(
      wave.map((row) => {
        const personId = personMap.get(phoneKey(row.clientNumber) ?? '') ?? null;
        const callerType = deriveCallerType(
          row.internalExtension ?? undefined,
          aiExtensions,
        );
        const cost = computeCallCostFromRate(
          {
            callType: row.callType,
            callerType,
            duration: row.duration,
          },
          rates,
        );
        const data: Record<string, unknown> = {
          name: row.name,
          pbxCallId: row.pbxCallId,
          callId: row.callId,
          callType: row.callType,
          callStart: row.callStart,
          duration: row.duration,
          disposition: row.disposition,
          clientNumber: row.clientNumber,
          ourNumber: row.ourNumber,
          internalExtension: row.internalExtension,
          callerType,
          ...(cost ? { cost } : {}),
          ...(personId ? { personId } : {}),
        };
        return client
          .mutation({
            createCallLog: { __args: { data }, id: true },
          })
          .then((res) => ({
            linked: personId !== null,
            costed: cost !== null,
            id: (res as { createCallLog?: { id?: string } }).createCallLog?.id ?? null,
            row,
          }));
      }),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        created++;
        const value = r.value as {
          linked: boolean;
          costed: boolean;
          id: string | null;
          row: typeof toCreate[number];
        };
        if (value.linked) linked++;
        if (value.costed) costed++;
        if (value.id) {
          createdForEnrichment.push({
            id: value.id,
            pbxCallId: value.row.pbxCallId,
            callId: value.row.callId,
            duration: value.row.duration,
            hasRecording: false,
            hasTranscript: false,
          });
        }
      } else if (isUniqueConstraintError(r.reason)) {
        dupRace++;
      } else {
        failed++;
        console.warn(
          `[sync-zadarma-calls] create failed: ${String(r.reason).slice(0, 300)}`,
        );
      }
    }
    console.log(
      `[sync-zadarma-calls] batch ${Math.floor(i / MUTATION_BATCH) + 1} created=${created} dupRace=${dupRace} failed=${failed} linked=${linked}`,
    );
  }

  // Enrichment: fetch recording link + transcript for newly-created rows that
  // are long enough to be worth processing. Bounded by ENRICHMENT_BUDGET_MS so
  // we never blow the sync timeout. Anything left over surfaces via
  // enrichment.budgetExceeded and the user finishes it from the
  // "Enrich missing recordings" button in Settings.
  let enrichment: EnrichResult | undefined;
  if (createdForEnrichment.length > 0) {
    console.log(
      `[sync-zadarma-calls] enrichment starting for ${createdForEnrichment.length} new rows (budget ${ENRICHMENT_BUDGET_MS}ms)`,
    );
    enrichment = await enrichCallLogs(client, createdForEnrichment, {
      userKey,
      secret,
      maxBudgetMs: ENRICHMENT_BUDGET_MS,
    });
    console.log(
      `[sync-zadarma-calls] enrichment done processed=${enrichment.processed}/${createdForEnrichment.length} rec=${enrichment.enrichedRecording} tr=${enrichment.enrichedTranscript} skippedShort=${enrichment.skippedShort} skippedNoCallId=${enrichment.skippedNoCallId} budgetExceeded=${enrichment.budgetExceeded}`,
    );
  }

  // Race-condition dups (a webhook fired between our pre-query and our insert)
  // count toward skippedDup so the user sees the correct "already in DB" total.
  const totalSkippedDup = skippedDup + dupRace;

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[sync-zadarma-calls] DONE window=${windowFrom}..${windowTo} chunks=${chunks.length} fetched=${parsed.length} created=${created} skippedDup=${totalSkippedDup} linked=${linked} failed=${failed} elapsedMs=${elapsedMs}`,
  );

  return {
    ok: true,
    windowFrom,
    windowTo,
    fetched: parsed.length,
    created,
    skippedDup: totalSkippedDup,
    linked,
    failed,
    costed,
    elapsedMs,
    ...(enrichment ? { enrichment } : {}),
  };
};

export default defineLogicFunction({
  universalIdentifier: SYNC_ZADARMA_CALLS_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'sync-zadarma-calls',
  description:
    'Live sync: fetches PBX call history via Zadarma /v1/statistics/pbx/ and inserts new callLog rows (deduped by pbxCallId, auto-linked to Persons by phone suffix). Default window: max(callStart) - 1h → now. Custom range capped at 365 days. Rate-limited fetches in 31-day chunks (3 req/min).',
  timeoutSeconds: 300,
  handler,
  httpRouteTriggerSettings: {
    path: '/zadarma/sync-calls',
    httpMethod: 'POST',
    isAuthRequired: true,
    forwardedRequestHeaders: ['authorization'],
  },
});
