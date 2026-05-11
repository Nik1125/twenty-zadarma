import { type CoreApiClient } from 'twenty-client-sdk/core';

// Resolves the id of the most-recently-created opportunity for a Person.
// Used at row-insert time by the call / SMS handlers so a fresh callLog
// or smsLog auto-attaches to the same opportunity the operator is
// currently working on for that contact (Twenty's typical CRM pattern —
// most-recent-touch = currently-active deal).
//
// Returns null when:
//   - personId is empty / falsy
//   - the person has no opportunities
//   - the GraphQL call errors (treated as "no link rather than blocked
//     row insert" — the row inserts with opportunityId=null)
//
// Twenty's filter syntax rejects `pointOfContact: { id: { eq } }` —
// composite relations must be filtered through the synthesised
// `<relationName>Id` foreign-key field. The error from the server is
// explicit: "Cannot filter by relation field 'pointOfContact': use
// 'pointOfContactId' instead". Use that form.

export const findLatestOpportunityIdForPerson = async (
  client: CoreApiClient,
  personId: string | null | undefined,
): Promise<string | null> => {
  if (!personId) return null;
  try {
    const res = (await client.query({
      opportunities: {
        __args: {
          filter: { pointOfContactId: { eq: personId } },
          orderBy: [{ createdAt: 'DescNullsLast' }],
          first: 1,
        },
        edges: { node: { id: true } },
      },
    })) as {
      opportunities?: { edges?: Array<{ node: { id: string } }> };
    };
    return res.opportunities?.edges?.[0]?.node.id ?? null;
  } catch {
    return null;
  }
};

// Batched variant for sync-zadarma-calls and other bulk-insert paths.
// Issues ONE query per unique personId in `personIds` (deduped). Returns
// a Map<personId, opportunityId|null>. Callers can then look up the
// opportunityId by personId during the per-row create loop without
// triggering N+1 round-trips inside the hot path.
export const findLatestOpportunityIdsForPersons = async (
  client: CoreApiClient,
  personIds: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, string | null>> => {
  const out = new Map<string, string | null>();
  const unique = Array.from(
    new Set(personIds.filter((p): p is string => typeof p === 'string' && p.length > 0)),
  );
  // Conservative serial drain — keeps the helper safe to call inside
  // existing rate-limited contexts and avoids saturating the Twenty
  // API with parallel queries on big sync batches.
  for (const personId of unique) {
    const oppId = await findLatestOpportunityIdForPerson(client, personId);
    out.set(personId, oppId);
  }
  return out;
};
