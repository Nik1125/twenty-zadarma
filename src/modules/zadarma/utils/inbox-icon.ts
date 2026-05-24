import { CoreApiClient } from 'twenty-client-sdk/core';
import { MetadataApiClient } from 'twenty-client-sdk/metadata';

import { ZADARMA_INBOX_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER } from 'src/front-components/zadarma-inbox.front-component';

import { computeUnansweredThreads } from './compute-unanswered-threads';

// Event-driven signal for the "Zadarma Inbox" command button: its icon flips
// between IconBell (has unanswered SMS) and IconInbox (clean). Twenty reflects
// a commandMenuItem icon change live in the UI (no reload) — verified
// 2026-05-24 — so updating the metadata record IS a usable signal. No cron /
// no polling: we only touch the icon on the events that change the count
// (inbound SMS → HAS; reply / mark-read → recompute). See
// [[project-sms-inbox-standalone-page]].

export const INBOX_ICON_HAS = 'IconBell';
export const INBOX_ICON_EMPTY = 'IconInbox';
const SIGNAL_WINDOW_DAYS = 90;

// Set the inbox command icon, but only when it actually changes (steady state
// = zero metadata writes). Returns true if it mutated.
//
// Resolution: the installed commandMenuItem does NOT preserve its manifest
// universalIdentifier (comes back null), but it DOES keep a frontComponentId,
// and the frontComponent record DOES preserve its universalIdentifier. So we
// resolve frontComponent (by UID) → its installed id → the command whose
// frontComponentId matches. Verified 2026-05-24: matching the command by its
// own universalIdentifier silently found nothing (null).
export const setInboxIcon = async (
  meta: MetadataApiClient,
  icon: string,
): Promise<boolean> => {
  const fcRes = (await meta.query({
    frontComponents: { id: true, universalIdentifier: true },
  })) as {
    frontComponents?: Array<{ id: string; universalIdentifier: string | null }>;
  };
  const fc = (fcRes.frontComponents ?? []).find(
    (f) =>
      f.universalIdentifier ===
      ZADARMA_INBOX_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  );
  if (!fc) return false;

  const cmdRes = (await meta.query({
    commandMenuItems: { id: true, icon: true, frontComponentId: true },
  })) as {
    commandMenuItems?: Array<{
      id: string;
      icon: string | null;
      frontComponentId: string | null;
    }>;
  };
  const cmd = (cmdRes.commandMenuItems ?? []).find(
    (c) => c.frontComponentId === fc.id,
  );
  if (!cmd || cmd.icon === icon) return false;

  await meta.mutation({
    updateCommandMenuItem: {
      __args: { input: { id: cmd.id, icon } },
      icon: true,
    },
  });
  return true;
};

// Recompute the unanswered count and set the icon accordingly. Use after an
// event that may REDUCE the count to zero (reply, mark-read). The inbound-SMS
// path can skip the scan and call setInboxIcon(meta, INBOX_ICON_HAS) directly,
// since a fresh inbound guarantees at least one unanswered thread.
export const refreshInboxIcon = async (
  core: CoreApiClient,
  meta: MetadataApiClient,
): Promise<boolean> => {
  const { threads } = await computeUnansweredThreads(core, SIGNAL_WINDOW_DAYS);
  return setInboxIcon(
    meta,
    threads.length > 0 ? INBOX_ICON_HAS : INBOX_ICON_EMPTY,
  );
};
