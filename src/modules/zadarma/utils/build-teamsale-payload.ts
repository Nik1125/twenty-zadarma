import type { CreateLeadInput } from 'src/modules/zadarma/utils/teamsale-api';

// Composes a CreateLeadInput from a Twenty Person row. Pure helper —
// no I/O. Lives separately from teamsale-api.ts so the sync handler
// keeps its data-shaping logic isolated and unit-testable.
//
// Rules:
//  - `lead[name]` = "<firstName> <lastName>".trim() if either is set;
//    otherwise falls back to "+<phone>" so the lead never lands without
//    a visible identifier in TeamSale's list view.
//  - `lead[phones][0][phone]` = E.164 with leading "+". The Person's
//    phones.primaryPhone in Twenty stores just digits; we re-add "+".
//    If callingCode is set we trust the existing prefix; otherwise we
//    prepend "+" and emit the digits verbatim.
//  - `lead[lead_source]` defaults to "inbound_call" (the App's webhook
//    auto-create branch is the primary creator). The n8n FB-flow can
//    override per-call by sending leadSource via the
//    sync-person-to-teamsale handler.
//  - `lead[comment]` is left blank by this helper. Workspace-specific
//    comment authoring (e.g. "Created from FB lead form") belongs in
//    n8n adapters, not in the App's universal sync.

export type PersonForTeamSale = {
  name?: {
    firstName?: string | null;
    lastName?: string | null;
  } | null;
  phones?: {
    primaryPhoneNumber?: string | null;
    primaryPhoneCallingCode?: string | null;
  } | null;
};

export type BuildTeamSalePayloadOptions = {
  leadSource?: string; // default 'inbound_call'
  comment?: string;
};

const composeName = (
  person: PersonForTeamSale,
  fallback: string,
): string => {
  const first = person.name?.firstName?.trim() ?? '';
  const last = person.name?.lastName?.trim() ?? '';
  const joined = [first, last].filter(Boolean).join(' ').trim();
  return joined.length > 0 ? joined : fallback;
};

const composePhone = (person: PersonForTeamSale): string | null => {
  const raw = person.phones?.primaryPhoneNumber?.trim();
  if (!raw) return null;
  if (raw.startsWith('+')) return raw;
  // Twenty stores digits only when callingCode is split out — re-attach
  // it. Twenty's callingCode itself usually starts with "+" already.
  const callingCode = person.phones?.primaryPhoneCallingCode?.trim() ?? '';
  if (callingCode) {
    const cc = callingCode.startsWith('+') ? callingCode : `+${callingCode}`;
    // Avoid double-prefixing if the number already includes the cc digits.
    const ccDigits = cc.replace(/^\+/, '');
    if (raw.startsWith(ccDigits)) return `+${raw}`;
    return `${cc}${raw}`;
  }
  return `+${raw}`;
};

export const buildTeamSalePayload = (
  person: PersonForTeamSale,
  options: BuildTeamSalePayloadOptions = {},
): CreateLeadInput | null => {
  const phone = composePhone(person);
  if (!phone) return null;
  const name = composeName(person, phone);
  return {
    name,
    phone,
    leadSource: options.leadSource ?? 'inbound_call',
    ...(options.comment ? { comment: options.comment } : {}),
  };
};
