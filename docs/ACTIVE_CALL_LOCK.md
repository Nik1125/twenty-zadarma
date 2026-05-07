# Active call lock — consumer contract

A multi-actor call-center setup (human operator + AI voice agent + n8n outbound flow + extra staff) needs a single source of truth for "this Person is currently being called". The Zadarma App publishes that signal on `Person`; consumers read and decide. The App **never enforces** the lock.

## Fields

| Field on `Person` | Type | Written by | Meaning |
|---|---|---|---|
| `activeCallStatus` | `SELECT` (`IDLE` / `CALLING` / `COOLDOWN`, nullable) | Zadarma App (PBX webhook) | Current dial state |
| `activeCallCooldownUntil` | `DATETIME` (nullable) | Zadarma App (PBX webhook) | Timestamp at which `COOLDOWN` lapses |

`null` is normal — it just means there is no recorded call activity yet. Treat `null` exactly like `IDLE`.

## State machine

```
                   NOTIFY_START / NOTIFY_OUT_START / NOTIFY_INTERNAL
                                ─────────────────►
        ┌──────────────────┐                          ┌──────────────────┐
        │ IDLE (or NULL)   │                          │ CALLING          │
        │ cooldownUntil    │ ◄────────────────────    │ cooldownUntil    │
        │ = null           │  next call begins        │ = null           │
        └──────────────────┘                          └──────────────────┘
                ▲                                              │
                │ (lazy expiry — consumer-side check)           │ NOTIFY_END / NOTIFY_OUT_END
                │ status === COOLDOWN && now >= cooldownUntil   ▼
        ┌──────────────────┐
        │ COOLDOWN         │
        │ cooldownUntil    │
        │ = call_end + N min │
        └──────────────────┘
```

`N` = `ACTIVE_CALL_COOLDOWN_MINUTES` applicationVariable (default `5`, max `1440`). Configurable in **Settings → Zadarma → applicationVariables** (default tab).

## Consumer pseudocode

```ts
const isFreeToDial = (person: Person, now = new Date()): boolean => {
  const status = person.activeCallStatus;
  if (status == null || status === 'IDLE') return true;
  if (status === 'CALLING') return false;
  // COOLDOWN — check whether it has lapsed
  const until = person.activeCallCooldownUntil;
  if (until == null) return true; // defensive: cooldown without timestamp
  return new Date(until) >= now ? false : true;
};
```

GraphQL query for consumers (n8n / Retell / future click-to-call):

```graphql
query PersonDialLock($id: UUID!) {
  person(filter: { id: { eq: $id } }) {
    id
    activeCallStatus
    activeCallCooldownUntil
  }
}
```

## Trigger sources

| Zadarma webhook event | Action on matched `Person` |
|---|---|
| `NOTIFY_START` / `NOTIFY_OUT_START` / `NOTIFY_INTERNAL` | `activeCallStatus = 'CALLING'`, `activeCallCooldownUntil = null` |
| `NOTIFY_END` / `NOTIFY_OUT_END` | `activeCallStatus = 'COOLDOWN'`, `activeCallCooldownUntil = now + N min` |

If `Person` cannot be resolved by phone (orphan log), the lock is silently skipped — orphans get linked later via the **Re-link orphans** Settings action, which does not retroactively mutate the lock state.

## Why no background job clears `COOLDOWN`

Lazy consumer-side expiry avoids depending on a CRON / scheduler capability that Twenty App SDK 2.2 does not yet expose. The cost is that the field can read `COOLDOWN` long after the cooldown lapsed; the timestamp is the source of truth, the status is a hint.

## Optional: auto-reset `COOLDOWN` → `IDLE` via Twenty Workflow

If you want the status field to actually flip back to `IDLE` after the cooldown lapses (so the Person UI reads cleanly without consumers having to compute "is it really over?"), use a Twenty **Workflow** as the scheduler the App SDK lacks. This stays inside the "App publishes, consumers read" contract — the Workflow is a consumer that happens to write back.

**Graph**

```
[Trigger: Person updated]
        │
        ▼
[Filter: activeCallStatus === 'COOLDOWN']
        │
        ▼
[Delay: 5 min]                                ← match ACTIVE_CALL_COOLDOWN_MINUTES
        │
        ▼
[Re-fetch the same Person]
        │
        ▼
[Branch: activeCallStatus === 'COOLDOWN'
   AND activeCallCooldownUntil === <snapshot at trigger fire>]
        │ true                          │ false
        ▼                               ▼
[Update Person { activeCallStatus: 'IDLE',   [End — race detected;
                  activeCallCooldownUntil: null }]   the next COOLDOWN
                                              transition will start its
                                              own Workflow run]
```

**Why the snapshot check is race-safe**

If a second call begins during the 5-min delay, the PBX webhook writes either `CALLING` (start) or a fresh `COOLDOWN` with a new `activeCallCooldownUntil` (end). Either way, the live `activeCallCooldownUntil` no longer equals the value captured when the Workflow fired — the Branch evaluates `false` and skips. The Workflow run that fired for the **fresh** `COOLDOWN` (whose snapshot matches the live value) handles the reset on its own schedule.

This is stricter than a `cooldownUntil <= now` check: any change to the Person during the Delay aborts the reset, including a manual operator override. Desirable — operator intent should win.

**Twenty Workflow specifics**

- Twenty Workflow's trigger payload exposes the record at the moment the trigger fired; capture `activeCallCooldownUntil` from it. The Branch compares that captured value against the freshly-fetched record. If your Twenty version surfaces the trigger's `updatedAt` instead of arbitrary field snapshots, comparing `record.activeCallCooldownUntil === <trigger>.updatedAt` works the same way (it asserts "no write touched the Person between trigger fire and now").
- The Delay duration must match `ACTIVE_CALL_COOLDOWN_MINUTES`. If they drift apart, the worst case is "field stays in `COOLDOWN` longer than necessary" — consumers still read the timestamp correctly, so no functional break, just a UI hint that's stale. Re-edit the Workflow when you change the applicationVariable.
- Scaling: every call generates one Workflow run that sleeps for the cooldown window. For up to a few thousand calls per day this is unnoticeable; if you ever push tens of thousands, prefer an external CRON hitting a custom HTTP route trigger instead.

## Manual overrides

Operators can edit `activeCallStatus` directly in the Person UI to break a stuck `CALLING` (e.g. webhook lost). That is intentional — it is a normal Twenty SELECT field.

## Out of scope

- The App does not block dials — that is the consumer's job.
- SMS does not occupy the line and does not flip the lock.
- Multi-leg / queue tracking is not modelled — `activeCallStatus` answers "currently being called", not "full PBX state".

## Related issues

- [#19](https://github.com/Nik1125/twenty-zadarma/issues/19) — original spec
- [#15](https://github.com/Nik1125/twenty-zadarma/issues/15) — live-sync calls (alternative trigger source)
