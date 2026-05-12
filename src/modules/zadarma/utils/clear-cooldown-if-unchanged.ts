import { CoreApiClient } from 'twenty-client-sdk/core';

// Idempotent cooldown reset. Reads the Person, verifies activeCallStatus is
// still 'COOLDOWN' AND activeCallCooldownUntil matches the timestamp captured
// when cooldown was set. On match → flip to IDLE; on mismatch → no-op.
//
// Mismatch reasons (all desired no-ops):
//   - status changed (operator manual flip, or new CALLING in progress)
//   - cooldown extended (a new call ended after this scheduler was queued and
//     wrote a fresh cooldownUntil; that call's own scheduler will handle it)
//   - person deleted
//
// Returns a structured result so callers can log the disposition without
// re-running the query.
export type ClearCooldownResult =
  | { cleared: true }
  | { cleared: false; reason: 'person-not-found' }
  | { cleared: false; reason: 'status-changed'; currentStatus: string | null }
  | { cleared: false; reason: 'cooldown-extended'; currentCooldownUntil: string | null };

export const clearCooldownIfUnchanged = async (
  client: CoreApiClient,
  personId: string,
  expectedCooldownUntilIso: string,
): Promise<ClearCooldownResult> => {
  const res = (await client.query({
    people: {
      __args: { filter: { id: { eq: personId } } },
      edges: {
        node: {
          activeCallStatus: true,
          activeCallCooldownUntil: true,
        },
      },
    },
  })) as {
    people?: {
      edges?: Array<{
        node: {
          activeCallStatus: string | null;
          activeCallCooldownUntil: string | null;
        };
      }>;
    };
  };

  const current = res.people?.edges?.[0]?.node;
  if (!current) return { cleared: false, reason: 'person-not-found' };

  if (current.activeCallStatus !== 'COOLDOWN') {
    return {
      cleared: false,
      reason: 'status-changed',
      currentStatus: current.activeCallStatus,
    };
  }

  if (current.activeCallCooldownUntil !== expectedCooldownUntilIso) {
    return {
      cleared: false,
      reason: 'cooldown-extended',
      currentCooldownUntil: current.activeCallCooldownUntil,
    };
  }

  await client.mutation({
    updatePerson: {
      __args: {
        id: personId,
        data: {
          activeCallStatus: 'IDLE',
          activeCallCooldownUntil: null,
        },
      },
      id: true,
    },
  });

  return { cleared: true };
};
