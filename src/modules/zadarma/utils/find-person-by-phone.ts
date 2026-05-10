import { CoreApiClient } from 'twenty-client-sdk/core';

import { splitE164 } from 'src/modules/zadarma/utils/split-e164';

// Twenty stores phones split: primaryPhoneCallingCode='+48',
// primaryPhoneNumber='539923725'. Webhooks arrive with the full E.164 stuck
// together: '48539923725'. Match in 3 passes:
//   1) exact eq on the full E.164 (Person saved with full number in primary)
//   2) cc-aware fuzzy: callingCode == '+<cc>' AND primary endsWith last 9 —
//      protects against cross-country collisions (PL `48 579872402` and a
//      hypothetical UA `380 579872402` share the last 9 digits but have
//      different calling codes; without this pass the fuzzy match returns
//      the wrong Person).
//   3) cc-blind fuzzy: primary endsWith last 9 — fallback when callingCode
//      is null (legacy Persons without a split callingCode column).
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

  const { callingCode } = splitE164(e164NoPlus);
  if (callingCode) {
    const fuzzyCc = (await client.query({
      people: {
        __args: {
          filter: {
            phones: {
              primaryPhoneCallingCode: { eq: '+' + callingCode },
              primaryPhoneNumber: { endsWith: suffix },
            },
          },
        },
        edges: { node: { id: true } },
      },
    })) as { people?: { edges?: Array<{ node: { id: string } }> } };
    const ccHit = fuzzyCc.people?.edges?.[0]?.node.id;
    if (ccHit) return ccHit;
  }

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
