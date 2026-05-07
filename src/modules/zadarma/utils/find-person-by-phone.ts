import { CoreApiClient } from 'twenty-client-sdk/core';

// Twenty stores phones split: primaryPhoneCallingCode='+48',
// primaryPhoneNumber='539923725'. Webhooks arrive with the full E.164 stuck
// together: '48539923725'. Match in 2 passes:
//   1) exact eq (in case Person was saved with the full number in primary)
//   2) endsWith last 9 digits (works for most mobiles when the calling code
//      is stored separately on Person, and gracefully tolerates either format)
//
// Only consults `phones.primaryPhoneNumber`. Persons whose match lives in
// `phones.additionalPhones[]` are picked up by the rescan-orphans job
// (build-once map) — querying RAW_JSON via GraphQL filter is fragile, so the
// map approach is the canonical way to cover additional phones.
export const findPersonIdByClientNumber = async (
  client: CoreApiClient,
  e164NoPlus: string,
): Promise<string | null> => {
  if (!e164NoPlus) return null;

  const exact = (await client.query({
    people: {
      __args: {
        filter: { phones: { primaryPhoneNumber: { eq: e164NoPlus } } },
      },
      edges: { node: { id: true } },
    },
  })) as { people?: { edges?: Array<{ node: { id: string } }> } };
  const exactHit = exact.people?.edges?.[0]?.node.id;
  if (exactHit) return exactHit;

  if (e164NoPlus.length < 9) return null;
  const suffix = e164NoPlus.slice(-9);
  const fuzzy = (await client.query({
    people: {
      __args: {
        filter: { phones: { primaryPhoneNumber: { endsWith: suffix } } },
      },
      edges: { node: { id: true } },
    },
  })) as { people?: { edges?: Array<{ node: { id: string } }> } };
  return fuzzy.people?.edges?.[0]?.node.id ?? null;
};
