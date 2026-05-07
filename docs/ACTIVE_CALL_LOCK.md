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

## Manual overrides

Operators can edit `activeCallStatus` directly in the Person UI to break a stuck `CALLING` (e.g. webhook lost). That is intentional — it is a normal Twenty SELECT field.

## Out of scope

- The App does not block dials — that is the consumer's job.
- SMS does not occupy the line and does not flip the lock.
- Multi-leg / queue tracking is not modelled — `activeCallStatus` answers "currently being called", not "full PBX state".

## Related issues

- [#19](https://github.com/Nik1125/twenty-zadarma/issues/19) — original spec
- [#15](https://github.com/Nik1125/twenty-zadarma/issues/15) — live-sync calls (alternative trigger source)
