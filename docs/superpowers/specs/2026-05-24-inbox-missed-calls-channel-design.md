# Zadarma Inbox — Missed-Calls Channel (v2) — Design

**Date:** 2026-05-24
**Status:** Approved (design), pending implementation plan
**Branch base:** `main` @ v0.28.3
**Predecessor:** v1 SMS inbox channel (released v0.28.0–0.28.3, PRs #66/#67/#69)

## Summary

Add a second channel to the existing Zadarma Inbox: **missed inbound calls**. The
inbox frontComponent (used both as the left-nav standalone page and the right
side-panel command) gains a two-tab layout — **SMS** | **Calls** — each with its
own count badge and its own derived feed. The missed-calls channel is a
structural mirror of the SMS channel and is **purely additive**: it does not
touch the working SMS feed, the bell-icon signal, or the sound chime.

Same core principle as v1: **nothing is stored but the operator's dismiss
intent.** Counts are always derived from the call logs; only a per-Person
"cleared at" timestamp is persisted.

## Decisions (locked with user)

| # | Decision | Choice |
|---|---|---|
| 1 | Layout of 2 channels in one frontComponent | **Two tabs** (SMS \| Calls), each its own badge |
| 2 | What auto-resolves a missed-call thread | **Any OUT call OR a later real-answered IN call** |
| 3 | Bell icon + sound chime | **SMS-only** — calls channel never drives icon or sound |
| 4 | Any OUT call resolves, even an unanswered callback | **Yes** — operator performed the task; a client who never answers must not pin the thread forever |
| 5 | Endpoint shape | **Separate endpoints** (do not extend the green SMS path) |

## Data model

### New Person field — `zadarmaCallsClearedAt`
- File: `src/fields/zadarma-calls-cleared-at-on-person.field.ts`
- Type: `DATE_TIME`, nullable
- UID: `ab2911ea-53a8-4f54-a61e-756f3845e3f6`
- Exact mirror of `zadarmaSmsClearedAt` (`src/fields/zadarma-sms-cleared-at-on-person.field.ts`), wording adapted to calls.
- Icon: `IconPhone` (or `IconInbox` to match the SMS field — pick at build).
- Role: the **manual** dismiss marker for the calls channel. Set by the calls-tab ✓ button. Missed calls at or before this time are treated as handled.

### New applicationVariable — `MISSED_CALL_MIN_DURATION_SECONDS`
- File: `src/application-config.ts`, placed next to `MIN_CHARGEABLE_DURATION_SECONDS` (~L158).
- UID constant `MISSED_CALL_MIN_DURATION_SECONDS_VARIABLE_UNIVERSAL_IDENTIFIER` added to `src/constants/universal-identifiers.ts`.
- UID value: `93c9bcb5-23a7-43bd-9e82-612b487d25e0`
- Default: `'10'`
- Description: `[Manage in Custom tab] A call is "missed" if it is inbound and either not answered or shorter than this many seconds (ANSWERED ≤Ns are PBX ghosts with no real conversation). Separate from billing. Default: 10.`
- **Not** the same as `MIN_CHARGEABLE_DURATION_SECONDS` (15, billing) — distinct purpose, distinct value.

## Missed-call predicate (server-side, JS)

Computed in JavaScript inside the logic-function (fetch windowed calls, classify
in code) — avoids Twenty's "exactly one operator per field" GraphQL filter
limit, exactly as `compute-unanswered-threads` does for SMS.

Every **inbound** (`callType === 'IN'`) call is classified into exactly one of:

- **real-answered IN** — `disposition === 'ANSWERED' && duration >= MISSED_CALL_MIN_DURATION_SECONDS`
- **missed IN** — everything else (NO_ANSWER / BUSY / CANCEL / CALL_FAILED, **or** ANSWERED but `duration < threshold`)

The duration gate is required: data on Algeness (2026-05-24) showed ≥60 IN
calls marked ANSWERED that are ≤10s and ~96% have neither recording nor
transcript — PBX marks them ANSWERED but no real conversation happened.

`callType` enum is **IN / OUT only** (no MISSED value, despite
naming-conventions.md). `disposition` enum =
ANSWERED / NO_ANSWER / BUSY / CANCEL / CALL_FAILED.

## Thread resolution

Per Person, over the scanned window:

```
cutoff = max(
  lastOutCallMs,         // any OUT call (any disposition) — operator acted
  lastRealAnsweredInMs,  // they re-called and we picked up for real
  callsClearedMs         // manual ✓ → zadarmaCallsClearedAt
)

missed = IN-missed calls with callStart > cutoff
unreadCount = missed.length
lastAt = newest missed call's callStart
```

A Person appears in the calls tab while `unreadCount > 0`. This is the exact
shape of `compute-unanswered-threads` (which uses `lastOutMs` as the cutoff);
here the cutoff has two resolving sources instead of one.

Rationale for "any OUT resolves" (decision #4): the calls tab is the operator's
"haven't attempted a callback yet" list, not a "haven't connected yet" list. A
client who never answers must not pin the thread indefinitely. Once the operator
dials back, the task is done from the inbox's point of view.

## New util — `compute-missed-calls.ts`

`src/modules/zadarma/utils/compute-missed-calls.ts` — structural mirror of
`compute-unanswered-threads.ts`:

1. Window scan `callLogs` filtered `callStart: { gte: windowStart }`, paginate
   (PAGE_SIZE 200), accumulate per `personId`: `lastOutMs`, `lastRealAnsweredInMs`,
   and the list of missed IN calls (`{ ms, iso, clientNumber }`).
   Node fields fetched: `personId, callType, disposition, duration, callStart, clientNumber`.
2. Candidates = Persons with ≥1 missed IN call in the window.
3. Chunked `people(filter: { id: { in } })` fetch of `name` + `zadarmaCallsClearedAt`.
4. Per candidate: `cutoff = max(lastOutMs, lastRealAnsweredInMs, clearedMs)`;
   keep missed calls with `ms > cutoff`; emit thread, sort newest-first.

**Epoch-ms comparison throughout** (`Date.parse`), never ISO-string compare —
same mixed-precision lexical-sort trap documented in the SMS util.

Returns the same `Thread` shape as the SMS feed
(`{ personId, name, clientNumber, lastBody, lastAt, unreadCount }`). `lastBody`
is left empty server-side; the frontend renders `"Missed call"` (with `×N` when
`unreadCount > 1`) for call rows.

Accepts `windowDays` (default 90, mirrors SMS).

## Endpoints (isolated — SMS path untouched)

### `GET /s/zadarma/inbox/missed-calls`
- File: `src/logic-functions/inbox-missed-calls.logic-function.ts`
- UID: `9146dc1c-6350-4244-be2c-93c3c4028881`
- Mirror of `inbox.logic-function.ts`: `clampDays`, call `computeMissedCalls`,
  return `{ ok, threads, scanned, windowDays, elapsedMs }`.
- `isAuthRequired: true`, forwards `authorization`.

### `POST /s/zadarma/inbox/clear-calls`
- File: `src/logic-functions/inbox-clear-calls.logic-function.ts`
- UID: `7e2ad550-dcae-4265-97bd-ec39820f529e`
- Mirror of `inbox-clear.logic-function.ts`: read `personId`, stamp
  `zadarmaCallsClearedAt = now()`.
- **Does NOT call `refreshInboxIcon`** — the bell is SMS-only (decision #3).
- `isAuthRequired: true`, forwards `content-type` + `authorization`.

The existing `GET /zadarma/inbox` and `POST /zadarma/inbox/clear` are **not
modified** — zero regression risk to the released SMS channel.

## Frontend — `zadarma-inbox.front-component.tsx`

Additive changes only:

- New `tab` state: `'sms' | 'calls'` (default `'sms'`).
- **Tab row** above the list: two buttons, "SMS" and "Calls", each showing its
  channel's thread count as a badge; active tab highlighted. Replaces / augments
  the current single header.
- Second data path: `callThreads` state, `fetchMissedCalls` (GET
  `/s/zadarma/inbox/missed-calls`), its own 15s poll (`POLL_MS` reused).
- Render the active tab's list. Call rows show name + time + `"Missed call"`
  snippet (+ `×N` when count > 1) + count badge + ✓ button.
- `markRead` becomes channel-aware: SMS rows → `/inbox/clear` (unchanged), call
  rows → `/inbox/clear-calls`. Same optimistic-drop + re-sync-on-failure UX.
- Row click → `navigate('/object/person/:id#<tabId>')` — same Person deep-link
  to the Zadarma tab (which already shows call history) using the existing
  `tab-id` resolution.
- **Unchanged:** the `BEEP` chime (`soundTick` / `prevMaxAtRef`) stays gated on
  the SMS feed only; the bell-icon signal (`inbox-icon.ts`) is not referenced.
  No call-channel sound, no call-channel icon flip.

## Files

| Action | File | Purpose |
|---|---|---|
| NEW | `src/fields/zadarma-calls-cleared-at-on-person.field.ts` | calls dismiss marker |
| NEW | `src/modules/zadarma/utils/compute-missed-calls.ts` | derived missed-calls feed |
| NEW | `src/logic-functions/inbox-missed-calls.logic-function.ts` | GET feed endpoint |
| NEW | `src/logic-functions/inbox-clear-calls.logic-function.ts` | POST manual-clear endpoint |
| EDIT | `src/application-config.ts` | + `MISSED_CALL_MIN_DURATION_SECONDS` |
| EDIT | `src/constants/universal-identifiers.ts` | + appVar UID constant |
| EDIT | `src/front-components/zadarma-inbox.front-component.tsx` | tabs + 2nd channel |

## Out of scope (YAGNI)

- No change to the bell icon or chime (decision #3).
- No combined/merged feed (decision #1 = tabs).
- No "missed call" notification beyond the in-page badge.
- No new callLog field — missed-ness is fully derived from existing
  `callType` / `disposition` / `duration`.
- No backfill — the feed is a live window scan; legacy data is included
  automatically within the 90-day window.

## Testing

Lifecycle test (mirror of the v1 SMS test, synthetic callLogs on local):

1. Seed missed IN call → calls tab badge = 1.
2. Second missed IN (same Person) → count = 2 (one thread, `×2`).
3. Manual ✓ → 0 (stamps `zadarmaCallsClearedAt`).
4. New missed IN after clear → 1 again.
5. Seed OUT call to that Person → 0 (callback resolves).
6. New missed IN after the OUT → 1 again.
7. Seed real-answered IN (ANSWERED, duration ≥ threshold) after a missed IN → 0.
8. Seed ANSWERED-but-<10s IN → still counts as missed (ghost gate).

Confirm SMS tab + bell + chime are byte-for-byte unchanged in behaviour.

Note the vitest teardown gotcha (CONTRIBUTING.md): after `yarn vitest run`,
restore the local App with `yarn twenty -r local dev --once`.

## Rollout

Per project conventions: feature PR **without** a version bump; `/release` (which
must hit **both** coolify and algeness remotes) cuts the version in a separate
`chore(release):` commit. Watch the known app-view-customization upgrade hazard
on Algeness (issue #68) when the new field migrates.
