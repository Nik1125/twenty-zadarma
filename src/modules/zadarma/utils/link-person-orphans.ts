import { CoreApiClient } from 'twenty-client-sdk/core';

// Twenty splits phone into primaryPhoneCallingCode (+48) and primaryPhoneNumber
// (539923725 — already without country code prefix). Our callLog/smsLog
// clientNumber is the full E.164 without `+` (48539923725). So matching
// orphaned records to a Person is `clientNumber.endsWith(primaryPhoneNumber)`.
//
// Consequence: if a Person is added to Twenty AFTER calls/SMS already arrived
// without a personId, this helper retroactively links them.
export const linkOrphansToPersonByPhone = async (
  client: CoreApiClient,
  personId: string,
  primaryPhoneNumber: string,
): Promise<{ linkedCallLogs: number; linkedSmsLogs: number }> => {
  if (!primaryPhoneNumber || primaryPhoneNumber.length < 4) {
    return { linkedCallLogs: 0, linkedSmsLogs: 0 };
  }

  const callLogsRes = (await client.query({
    callLogs: {
      __args: {
        filter: {
          and: [
            { personId: { is: 'NULL' } },
            { clientNumber: { endsWith: primaryPhoneNumber } },
          ],
        },
      },
      edges: { node: { id: true } },
    },
  })) as { callLogs?: { edges?: Array<{ node: { id: string } }> } };
  const callLogIds = (callLogsRes.callLogs?.edges ?? []).map((e) => e.node.id);

  for (const id of callLogIds) {
    await client.mutation({
      updateCallLog: {
        __args: { id, data: { personId } },
        id: true,
      },
    });
  }

  const smsLogsRes = (await client.query({
    smsLogs: {
      __args: {
        filter: {
          and: [
            { personId: { is: 'NULL' } },
            { clientNumber: { endsWith: primaryPhoneNumber } },
          ],
        },
      },
      edges: { node: { id: true } },
    },
  })) as { smsLogs?: { edges?: Array<{ node: { id: string } }> } };
  const smsLogIds = (smsLogsRes.smsLogs?.edges ?? []).map((e) => e.node.id);

  for (const id of smsLogIds) {
    await client.mutation({
      updateSmsLog: {
        __args: { id, data: { personId } },
        id: true,
      },
    });
  }

  return { linkedCallLogs: callLogIds.length, linkedSmsLogs: smsLogIds.length };
};
