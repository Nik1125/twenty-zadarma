import { CoreApiClient } from 'twenty-client-sdk/core';

// Best-effort cleanup of Person rows where activeCallStatus='COOLDOWN' but
// activeCallCooldownUntil is already in the past. Recovery path for the
// inline setTimeout auto-clear in handle-zadarma-pbx-webhook — if that timer
// never fires (container restart, expired auth token in detached callback,
// SDK refresh path unavailable on server-side), the next NOTIFY_END /
// NOTIFY_START on the workspace will self-heal stuck rows here.
//
// Caps the batch to MAX_BATCH so a one-off backlog drains across several
// webhook fires instead of one heavy query. Errors are swallowed (logged)
// because this is a safety net — a sweep failure must not break the
// primary webhook flow.
const MAX_BATCH = 50;

// Twenty GraphQL date-time filter rejects sub-second precision and +hh:mm
// offsets — accepts only `YYYY-MM-DDTHH:mm:ssZ`.
const isoSecondPrecisionUtc = (d: Date): string =>
  `${d.toISOString().slice(0, 19)}Z`;

export const sweepStaleCooldowns = async (
  client: CoreApiClient,
  nowIso: string = isoSecondPrecisionUtc(new Date()),
): Promise<{ swept: number }> => {
  let swept = 0;
  let ids: string[] = [];

  try {
    const res = (await client.query({
      people: {
        __args: {
          first: MAX_BATCH,
          filter: {
            and: [
              { activeCallStatus: { eq: 'COOLDOWN' } },
              { activeCallCooldownUntil: { lt: nowIso } },
            ],
          },
        },
        edges: { node: { id: true } },
      },
    })) as { people?: { edges?: Array<{ node: { id: string } }> } };

    ids = res.people?.edges?.map((e) => e.node.id) ?? [];
  } catch (err) {
    console.warn(
      '[zadarma-pbx-webhook] sweep stale cooldown query failed:',
      err,
    );
    return { swept: 0 };
  }

  for (const id of ids) {
    try {
      await client.mutation({
        updatePerson: {
          __args: {
            id,
            data: {
              activeCallStatus: 'IDLE',
              activeCallCooldownUntil: null,
            },
          },
          id: true,
        },
      });
      swept += 1;
    } catch (err) {
      console.warn(
        `[zadarma-pbx-webhook] sweep stale cooldown failed personId=${id}:`,
        err,
      );
    }
  }

  if (swept > 0) {
    console.log(
      `[zadarma-pbx-webhook] sweep stale cooldown — swept ${swept} person(s) → IDLE`,
    );
  }

  return { swept };
};
