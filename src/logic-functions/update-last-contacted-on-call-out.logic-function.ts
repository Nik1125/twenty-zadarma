import { defineLogicFunction } from 'twenty-sdk/define';
import {
  type DatabaseEventPayload,
  type ObjectRecordCreateEvent,
} from 'twenty-sdk/logic-function';
import { CoreApiClient } from 'twenty-client-sdk/core';

import { updateLastContactedIfNewer } from 'src/modules/zadarma/utils/update-last-contacted';

type CallLogAfter = {
  id?: string;
  callType?: 'IN' | 'OUT' | string | null;
  personId?: string | null;
  callStart?: string | null;
};

const handler = async (
  event: DatabaseEventPayload<ObjectRecordCreateEvent<CallLogAfter>>,
) => {
  const after = event.properties?.after;
  const callType = after?.callType;
  const personId = after?.personId;

  if (callType !== 'OUT') {
    return { ok: true, skipped: 'not outbound' };
  }
  if (!personId) {
    return { ok: true, skipped: 'no personId on callLog' };
  }

  // Use callStart (the actual moment the call started) when available;
  // fall back to "now" only if the webhook handler somehow created a row
  // without it. callStart is more accurate for backfill ordering and lines
  // up with what the recompute endpoint computes from history.
  const candidateIso = after?.callStart ?? new Date().toISOString();

  const client = new CoreApiClient();
  const result = await updateLastContactedIfNewer(
    client,
    personId,
    candidateIso,
  );

  console.log(
    `[update-last-contacted-on-call-out] callLogId=${after?.id} personId=${personId} callStart=${candidateIso} updated=${result.updated} reason=${result.reason ?? '-'}`,
  );

  return { ok: true, ...result };
};

export default defineLogicFunction({
  universalIdentifier: 'a7c36a82-eecb-4cee-9bc8-529906ce6bda',
  name: 'update-last-contacted-on-call-out',
  description:
    'When a callLog is created with callType=OUT and a Person link, updates Person.lastContactedAt to the call start time (only if newer than the current value).',
  timeoutSeconds: 10,
  handler,
  databaseEventTriggerSettings: {
    eventName: 'callLog.created',
  },
});
