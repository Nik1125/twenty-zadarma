// Resolves the `caller_id` param sent to Zadarma's /v1/sms/send/ for an
// outbound SMS. Zadarma accepts either a pre-approved alphanumeric Sender ID
// (registered in the cabinet — e.g. "Hyalual", visible in the "Od kogo"
// dropdown when sending SMS manually) or a plain numeric DID. We default to
// the numeric DID (current, always-safe behaviour) and only switch to the
// alphanumeric Sender ID when an operator explicitly configures one via the
// ZADARMA_SMS_SENDER_ID applicationVariable — so an empty/cleared variable
// reverts to the phone number with zero code changes, satisfying the
// "roll back if the Sender ID misbehaves" requirement.
export const resolveSmsCallerId = (
  senderId: string | null | undefined,
  ourNumber: string,
): string => {
  const trimmed = senderId?.trim();
  return trimmed ? trimmed : ourNumber;
};
