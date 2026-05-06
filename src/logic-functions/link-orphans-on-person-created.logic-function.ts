import { defineLogicFunction } from 'twenty-sdk/define';
import {
  type DatabaseEventPayload,
  type ObjectRecordCreateEvent,
} from 'twenty-sdk/logic-function';
import { CoreApiClient } from 'twenty-client-sdk/core';

import { linkOrphansToPersonByPhone } from 'src/modules/zadarma/utils/link-person-orphans';

type PersonAfter = {
  id?: string;
  phones?: {
    primaryPhoneNumber?: string | null;
    primaryPhoneCountryCode?: string | null;
    primaryPhoneCallingCode?: string | null;
  } | null;
};

const handler = async (
  event: DatabaseEventPayload<ObjectRecordCreateEvent<PersonAfter>>,
) => {
  const personId = event.recordId;
  const phone = event.properties?.after?.phones?.primaryPhoneNumber;
  if (!personId || !phone) {
    return { ok: true, skipped: 'no personId or phone' };
  }

  const client = new CoreApiClient();
  const result = await linkOrphansToPersonByPhone(client, personId, phone);
  console.log(
    `[link-orphans-on-person-created] personId=${personId} phone=${phone} linked callLogs=${result.linkedCallLogs} smsLogs=${result.linkedSmsLogs}`,
  );
  return { ok: true, ...result };
};

export default defineLogicFunction({
  universalIdentifier: 'cae8bc33-6c22-4910-8508-e86f46076da8',
  name: 'link-orphans-on-person-created',
  description:
    'When a Person is created, retroactively link any callLog/smsLog records that came in earlier with this client number.',
  timeoutSeconds: 30,
  handler,
  databaseEventTriggerSettings: {
    eventName: 'person.created',
  },
});
