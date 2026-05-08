export type PersonOptOutFields = {
  doNotSms?: boolean | null;
  doNotSmsAt?: string | null;
  doNotSmsReason?: string | null;
};

export const isOptedOutOfSms = (
  person: PersonOptOutFields | null | undefined,
): boolean => {
  return person?.doNotSms === true;
};

export const formatOptOutMessage = (
  person: PersonOptOutFields | null | undefined,
): string => {
  // Twenty initialises TEXT fields to '' (not null) when no value is set —
  // treat empty string the same as null so the rendered message stays
  // "no reason recorded" instead of "Reason: .".
  const at = person?.doNotSmsAt && person.doNotSmsAt.length > 0 ? person.doNotSmsAt : 'unknown date';
  const reason =
    person?.doNotSmsReason && person.doNotSmsReason.length > 0
      ? person.doNotSmsReason
      : 'no reason recorded';
  return `Person has opted out of SMS (${at}). Reason: ${reason}.`;
};
