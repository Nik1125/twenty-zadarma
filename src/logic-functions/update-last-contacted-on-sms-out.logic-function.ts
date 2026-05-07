import { defineLogicFunction } from 'twenty-sdk/define';
import {
  type DatabaseEventPayload,
  type ObjectRecordCreateEvent,
} from 'twenty-sdk/logic-function';
import { CoreApiClient } from 'twenty-client-sdk/core';

import { updateLastContactedIfNewer } from 'src/modules/zadarma/utils/update-last-contacted';

type SmsLogAfter = {
  id?: string;
  direction?: 'IN' | 'OUT' | string | null;
  personId?: string | null;
  sentAt?: string | null;
};

const handler = async (
  event: DatabaseEventPayload<ObjectRecordCreateEvent<SmsLogAfter>>,
) => {
  const after = event.properties?.after;
  const direction = after?.direction;
  const personId = after?.personId;

  if (direction !== 'OUT') {
    return { ok: true, skipped: 'not outbound' };
  }
  if (!personId) {
    return { ok: true, skipped: 'no personId on smsLog' };
  }

  // Use sentAt (when the SMS was sent) when set; fall back to "now". Mirrors
  // the call-out trigger so the live and backfill paths stay symmetric.
  const candidateIso = after?.sentAt ?? new Date().toISOString();

  const client = new CoreApiClient();
  const result = await updateLastContactedIfNewer(
    client,
    personId,
    candidateIso,
  );

  console.log(
    `[update-last-contacted-on-sms-out] smsLogId=${after?.id} personId=${personId} sentAt=${candidateIso} updated=${result.updated} reason=${result.reason ?? '-'}`,
  );

  return { ok: true, ...result };
};

export default defineLogicFunction({
  universalIdentifier: '1e88f22f-242f-40e1-9510-e1a4064eb3fd',
  name: 'update-last-contacted-on-sms-out',
  description:
    'When a smsLog is created with direction=OUT and a Person link, updates Person.lastContactedAt to the sent timestamp (only if newer than the current value).',
  timeoutSeconds: 10,
  handler,
  databaseEventTriggerSettings: {
    eventName: 'smsLog.created',
  },
});
