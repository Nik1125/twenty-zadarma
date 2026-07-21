# Twenty App install/upgrade failure playbook

Symptom: `yarn twenty -r <remote> install` (or the auto-upgrade path inside `install`)
returns a generic error —

```
{ "message": "BUILDER_INTERNAL_SERVER_ERROR",
  "extensions": { "userFriendlyMessage": "An error occurred during workspace migration." } }
```

— on a workspace that already has this App installed. This is **never** a
code bug in this repo's `src/`. It is one of two known root causes below.
Code-only changes (editing `application-config.ts`, etc.) will not fix either.

## Root cause 1 — view-field ownership drift (issue #68)

When an operator customizes an App-owned view through the Twenty UI
(add/remove/reorder columns on "All calls" / "All SMS" / the FIELDS_WIDGET
views), Twenty reassigns the affected `viewField` rows to a per-workspace
pseudo-app called **"Workspace's custom application"** so the customization
survives updates. On the *next* App manifest sync — for **any** change, not
just view-related ones (confirmed 2026-07-22: a plain new `applicationVariable`
addition, no view changes at all, hit this) — the App's manifest builder scopes
its flat-entity-map lookup to its own `applicationId` and can't find those
view-fields anymore → `FlatEntityMapsException: Could not find flat entity
with universal identifier <uuid>` → the whole migration batch rolls back.

**This recurs.** First hit 2026-05-24 (v0.28.0 → Algeness), fixed, then hit
again 2026-07-22 (v0.30.0 → Algeness) on the *same* workspace — the operator
had customized columns again in the interim. Treat this as a standing
operational cost of shipping App-owned views, not a one-time fix.

### Diagnosis (read-only)

Pull server logs around the failed install and grep for the real error —
the CLI/GraphQL response only ever shows the generic wrapper:

```bash
docker logs <twenty-server-container> --since 2h 2>&1 \
  | grep -i -A20 -B5 "FlatEntityMapsException\|BUILDER_INTERNAL_SERVER_ERROR\|workspace migration"
```

This gives the orphan `universalIdentifier`. Then, read-only in Postgres:

```sql
-- what is it?
SELECT id, "universalIdentifier", "applicationId", "viewId", "fieldMetadataId"
FROM core."viewField" WHERE "universalIdentifier" = '<uuid-from-logs>';

-- what view does it belong to, and who owns that view?
SELECT v.id, v.name, v."applicationId" AS view_owner
FROM core."view" v WHERE v.id = (SELECT "viewId" FROM core."viewField" WHERE "universalIdentifier" = '<uuid>');

-- full scope: every view-field mis-owned by the custom-app under a Zadarma-owned view
SELECT vf.id, vf."universalIdentifier", v.name
FROM core."viewField" vf JOIN core."view" v ON v.id = vf."viewId"
WHERE v."applicationId" = '<zadarma-app-id>' AND vf."applicationId" = '<custom-app-id>';
```

Find both app ids first via GraphQL `/metadata`: `{ findManyApplications { id name universalIdentifier version } }`
(no server/DB access needed for this part — the App-install API key is enough).
"Workspace's custom application" and the Zadarma app id are workspace-specific —
re-look-up per remote, don't reuse ids across workspaces.

### Fix (write, get explicit sign-off before running — real prod)

1. **Postgres** — reassign ownership back to the App. Non-destructive: the
   operator's column choices (order/visibility) are untouched, only the
   bookkeeping `applicationId` changes. Scope tightly by the exact row ids
   found above, not a broad `WHERE` — safer on a live workspace:
   ```sql
   UPDATE core."viewField" SET "applicationId" = '<zadarma-app-id>'
   WHERE id IN ('<id1>', '<id2>', ...) AND "applicationId" = '<custom-app-id>'
   RETURNING id, "applicationId";
   ```
   Confirm the row count returned matches exactly what you expected.
2. **Redis** — flush only the flat-entity cache, never `FLUSHALL`:
   ```bash
   docker exec <redis-container> redis-cli --scan --pattern '*flat*' \
     | xargs -r docker exec <redis-container> redis-cli unlink
   ```
   (Keys look like `engine:workspace:flat-maps:*`. Skip `bull:`/`bullmq:` keys.)
3. **Restart** the server + worker containers:
   ```bash
   docker restart <twenty-server-container> <worker-container>
   ```
4. **Bump the App version again and reinstall** — see the "already installed"
   gotcha below; this step is *not* optional even though no code changed.

## Root cause 2 — SDK/server std-field collision (2.20+)

Separate, unrelated failure with the same generic error surface. `twenty-sdk`
2.3.0's `defineObject` emits standard system fields (`id`, `createdAt`,
`createdBy`, `deletedAt`, `position`, `updatedAt`, `updatedBy`, `searchVector`)
with deterministic UIDs. Twenty **server 2.20+** owns these itself, so the
sync fails with 16 `fieldMetadata` errors (`NOT_AVAILABLE` / `FIELD_MUTATION_NOT_ALLOWED:
System fields cannot be deleted`, 8 fields × 2 objects). No amount of
Postgres/Redis cleanup fixes this — it needs `twenty-sdk` + `twenty-client-sdk`
bumped to match the server's minor (verified fix: bump to 2.20.0, see
`project_sdk_manifest_std_fields_2.20.md` memory / issue #71, work in progress
on `chore/upgrade-twenty-2.20`).

**Distinguishing the two:** pull the same server logs. Root cause 1 throws
`FlatEntityMapsException` from `FlatViewFieldValidatorService`. Root cause 2
throws `NOT_AVAILABLE`/`FIELD_MUTATION_NOT_ALLOWED` from field-metadata
validation, no view-field involved at all.

**Known state (2026-07-22):** Coolify's Twenty server silently upgraded to
**v2.20.0** sometime between 2026-07-11 and 2026-07-22 — independent of this
repo's own SDK-2.20 migration work, which is still mid-flight on a separate
branch and not merged to `main`. This means **Coolify's Zadarma App install is
currently broken by root cause 2** (confirmed via a real install attempt) and
will stay broken until either the server is rolled back or the App is
upgraded to SDK 2.20.0 and released. Algeness's server was still on an older,
SDK-2.3.0-compatible version as of the same date — root cause 2 does not
apply there (only root cause 1 did, and is now fixed as of App v0.30.2).
**Do not treat Coolify and Algeness as interchangeable test targets** — check
each remote's actual server version before assuming a release will behave
the same on both.

## Gotchas that waste time if you don't know them

- **"already installed" after a version bump does not mean it synced.**
  `installMarketplaceApp` short-circuits to `APP_ALREADY_INSTALLED` when the
  target version already matches the recorded `Application.version` — even if
  the previous attempt at that version rolled back mid-migration and left
  fields/variables missing. If you've just fixed the actual blocker (root
  cause 1 or 2), you must bump the version *again* (e.g. 0.30.1 → 0.30.2) and
  redeploy+reinstall to force a fresh sync attempt. Retrying the *same*
  version after a fix will falsely report success.
- **CLI errors can lie in both directions.** `BUILDER_INTERNAL_SERVER_ERROR`
  sometimes reflects a real rolled-back migration (as above), but a
  `BUILDER_INTERNAL_SERVER_ERROR` on the CLI can *also* occur on an install
  that actually completed server-side (CLI-side timeout/disconnect). Always
  probe `findOneApplication(universalIdentifier) { version applicationVariables { key value } }`
  via `/metadata` after ANY install attempt, success or failure reported,
  before declaring either outcome. Don't trust the CLI's own text.
- **Stale `node_modules` after switching branches with a different SDK pin.**
  If you've had `twenty-sdk`/`twenty-client-sdk` at a different version on
  another branch (e.g. the `chore/upgrade-twenty-2.20` branch pins 2.20.0)
  and then `git checkout` back to a branch pinning 2.3.0 without re-running
  `yarn install`, `node_modules/twenty-sdk` keeps the *old* branch's files —
  `package.json`/`yarn.lock` say one version, the installed CLI binary is
  another. This produces confusing, inconsistent failures across different
  remotes (one remote errors on field-collision because the CLI built a
  2.20-shaped manifest, another errors on a GraphQL shape mismatch because
  its server is genuinely older) that look like server-side bugs but are
  purely a local build artifact. **Always check
  `cat node_modules/twenty-sdk/package.json | grep version` matches
  `package.json`'s pin before any `deploy`/`install`**, especially right
  after a branch switch. Fix: plain `yarn install` (no flags needed if the
  lockfile itself is already correct for the checked-out branch).
- **No direct SSH/docker access to a customer's host?** Diagnose in two
  read-only round trips before proposing any write: (1) container names +
  targeted `docker logs` grep, (2) the Postgres SELECTs above, scoped by the
  exact ids logs gave you. Only after the operator/relay confirms the exact
  row-level diagnosis, hand over a **write** script scoped to specific
  primary keys (never a broad `WHERE`), and get explicit user sign-off before
  it's sent — this is a real customer's production database.

## Related

- Issue #68 (view-field ownership drift), first hit 2026-05-24, recurred 2026-07-22.
- Issue #71 (SDK 2.20 migration), in progress on `chore/upgrade-twenty-2.20`.
- `docs/upgrade/` (on the 2.20 branch) for the broader server-upgrade plan.
