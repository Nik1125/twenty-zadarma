import { defineLogicFunction } from 'twenty-sdk/define';
import {
  type DatabaseEventPayload,
  type ObjectRecordUpdateEvent,
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
  event: DatabaseEventPayload<ObjectRecordUpdateEvent<PersonAfter>>,
) => {
  const personId = event.recordId;
  const phone = event.properties?.after?.phones?.primaryPhoneNumber;
  if (!personId || !phone) {
    return { ok: true, skipped: 'no personId or phone' };
  }

  const client = new CoreApiClient();
  const result = await linkOrphansToPersonByPhone(client, personId, phone);
  console.log(
    `[link-orphans-on-person-updated] personId=${personId} phone=${phone} linked callLogs=${result.linkedCallLogs} smsLogs=${result.linkedSmsLogs}`,
  );
  return { ok: true, ...result };
};

export default defineLogicFunction({
  universalIdentifier: '26a606bf-23f9-4f72-b5ca-ee486dd22a1a',
  name: 'link-orphans-on-person-updated',
  description:
    'When a Person.phones is updated, retroactively link any callLog/smsLog records with the new client number.',
  timeoutSeconds: 30,
  handler,
  databaseEventTriggerSettings: {
    eventName: 'person.updated',
    updatedFields: ['phones'],
  },
});
