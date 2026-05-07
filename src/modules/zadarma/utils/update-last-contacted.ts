import { CoreApiClient } from 'twenty-client-sdk/core';

// Single source of truth for "set Person.lastContactedAt = candidate iff
// candidate is newer". Used by both DB-event triggers (call OUT, SMS OUT)
// and the backfill recompute endpoint.
//
// The newer-than-current guard matters because triggers fire in arrival
// order, not in chronological order: backfilling old logs after live data
// would otherwise overwrite a fresh timestamp with a stale one.
export const updateLastContactedIfNewer = async (
  client: CoreApiClient,
  personId: string,
  candidateIso: string,
): Promise<{ updated: boolean; reason?: string }> => {
  if (!personId || !candidateIso) {
    return { updated: false, reason: 'missing personId or candidate' };
  }

  const personRes = (await client.query({
    person: {
      __args: { filter: { id: { eq: personId } } },
      id: true,
      lastContactedAt: true,
    },
  })) as { person?: { id?: string; lastContactedAt?: string | null } | null };

  const current = personRes.person?.lastContactedAt ?? null;
  // ISO 8601 strings compare lexicographically the same way they compare
  // chronologically as long as they're both UTC ("Z" suffix) and same length.
  // GraphQL DATE_TIME returns ISO; both callStart and sentAt are stored as UTC.
  if (current && current >= candidateIso) {
    return { updated: false, reason: 'current is newer or equal' };
  }

  await client.mutation({
    updatePerson: {
      __args: { id: personId, data: { lastContactedAt: candidateIso } },
      id: true,
    },
  });

  return { updated: true };
};
