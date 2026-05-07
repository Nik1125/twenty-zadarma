# Contributing

Thanks for taking a look. This file collects the conventions used across the project — naming, IDs, phone format, secrets, dev workflow — so a new contributor (or future me) doesn't have to reverse-engineer them from the code. Read once, refer back when you need a rule.

If you find a convention that's not documented, please add it here in the same PR that introduces it.

## Prerequisites

- **OS**: WSL2 on Windows, native Linux, or macOS. Native Windows fails on Nx Unix shell commands used by Twenty's monorepo tooling.
- **Node**: 20.x (matches Twenty 2.2 server).
- **Yarn**: classic `yarn` (not Berry).
- **Twenty server**: `>=2.2.0` (pinned via `engines.twenty` in `package.json`).
- **Twenty server feature flag**: `LOGIC_FUNCTION_TYPE=app` must be set on any self-hosted server you install this App into. See `README.md` for details.

## Local dev setup

```bash
yarn install
yarn twenty server start                    # local Twenty 2.2 on http://localhost:2020
yarn twenty -r local install                # install this App on the local server (one-time)
yarn twenty -r local dev                    # watch mode — re-syncs on save
```

Use `yarn twenty -r local dev --once` for a single non-watch sync.

## Repo layout

```
src/
  application-config.ts          App identity + applicationVariables
  default-role.ts                Default RBAC role for the App
  constants/                     Shared UUIDs and string constants
  objects/                       Custom objects (callLog, smsLog, zadarmaWebhookEvent)
  fields/                        Field definitions (one per file, links Person ↔ logs)
  views/                         Index views per object
  page-layouts/                  Standard-object page layout overrides
  page-layout-tabs/              Tabs added to standard objects (Person, etc.)
  navigation-menu-items/         Sidebar entries
  logic-functions/               Webhook handlers, route triggers, db-event triggers
  front-components/              Custom React components (Settings panel, Person panel)
  modules/zadarma/
    connector/                   Signing + webhook verification
    utils/                       normalize-phone, find-person-by-phone, etc.
  __tests__/                     Vitest setup + integration tests
```

External:
- `.claude/skills/zadarma-api/` — Zadarma API reference for AI assistants.
- `CLAUDE.md` — architecture cheat sheet for AI assistants. Same source-of-truth as this file for rules; if they disagree, `CONTRIBUTING.md` wins.

## File naming

- All files are **kebab-case** with descriptive suffixes:
  - `*.object.ts`
  - `*.field.ts`
  - `*.view.ts`
  - `*.navigation-menu-item.ts`
  - `*.logic-function.ts`
  - `*.front-component.tsx`
  - `*.page-layout.ts` / `*.page-layout-tab.ts`
- Tests next to source: `foo.test.ts` (unit), `foo.integration-test.ts` (integration).
- Skills under `.claude/skills/<skill-name>/SKILL.md` + `references/`.

## TypeScript / React rules

- **No `any`.** Use `unknown` and narrow, or use precise types. Cast with `as` only when narrowing isn't possible (e.g. typing GraphQL responses); explain why in a comment.
- **Types over interfaces** — except when extending a third-party interface that requires interface merging.
- **String-literal unions** over `enum`.
- **Named exports only**, except where Twenty's build step requires `export default` (object/field/view/navigation-menu-item/logic-function/front-component/page-layout-tab `define*` calls).
- **Functional components only** — no class components.
- **Imports order**: external libs, then `src/...` absolute, then relative (`./`, `../`).
- **Comments**: `//` only, never `/** */`. Explain the **why**, not the **what**. If removing the comment wouldn't confuse a future reader, don't write it. Avoid referencing the current task or PR — those rot.

## Universal identifiers (UUIDs)

- Every `define*({ universalIdentifier: '<uuid>' })` is a **UUID v4**. Generate with `uuidgen` (not online tools, not hand-crafted).
- **Never change a published `universalIdentifier`.** It's the migration key — changing it makes Twenty treat it as a new entity, breaking installs on every existing instance.
- Never reuse one across entity kinds.

If you need a UUID:

```bash
uuidgen
```

Add it to `src/constants/universal-identifiers.ts` only if it's referenced from more than one file; otherwise inline it where it's used.

## ID schemes (records)

Rule of thumb: **if the source platform supplies a stable unique ID, use it as-is.** Mint a synthetic ID only when no platform ID is available — currently this is just the two SMS-without-ID cases below.

| Object       | Source                                      | Field         | ID source                                    | Format                              | Uniqueness     |
|--------------|---------------------------------------------|---------------|----------------------------------------------|-------------------------------------|----------------|
| `callLog`    | Zadarma webhook (`NOTIFY_END`)              | `pbxCallId`   | Zadarma `pbx_call_id`                        | `in_<digits>` / `out_<digits>`      | global         |
| `callLog`    | Zadarma stats CSV (`/calls/`)               | `pbxCallId`   | Zadarma `call_id` column                     | `in_<digits>` / `out_<digits>`      | global         |
| `callLog`    | Retell.ai webhook (planned, v0.5)           | `retellCallId`| Retell `call_id`                             | string                              | global         |
| `smsLog`     | Zadarma webhook (real-time inbound)         | `messageId`   | **synthetic** — Zadarma provides no ID       | `<num>-<tsCompact>-<4hex>` (below)  | per-workspace  |
| `smsLog`     | Zadarma `/sms/send` response (outbound)     | `messageId`   | **synthetic** — Zadarma response carries no ID | same synthetic format             | per-workspace  |
| `smsLog`     | Zadarma history-page export (JSON parse)    | `messageId`   | row's `id` field                             | string                              | global         |
| `zadarmaWebhookEvent` | any                                | `id`          | Twenty auto                                  | UUID v4                             | per-workspace  |

### Synthetic ID format (smsLog only)

For the two SMS cases above where Zadarma supplies no ID, mint one with this format:

```
<clientNumber>-<isoTimestampCompact>-<4hexRandom>
```

- `clientNumber`: E.164 without `+` (e.g. `48539923725`)
- `isoTimestampCompact`: ISO 8601 with millisecond precision, separators stripped (`20260507T221543123` for `2026-05-07T22:15:43.123Z`)
- `4hexRandom`: 4 lowercase hex chars (e.g. `a3f9`). Resolves the rare same-millisecond same-recipient collision.

**Example**: `48539925725-20260507T221543123-a3f9` (33 chars)

**Why this shape**:
- **Sortable**: timestamp prefix means `ORDER BY messageId` is chronological inside one client.
- **Debuggable**: human can read the recipient and time without decoding.
- **Hard to collide**: same recipient + same millisecond + same 4-hex = 1/65536. In a small-biz dataset, effectively zero.
- **Decoupled from source**: no `inbound-` or `sent-` prefix. Direction belongs in the `name` field (e.g. `IN 48539925725`), not in the identity. Mixing description with identity makes it harder to dedupe and couples the ID to current process labels.

**Dedup rules**:
- For platform-supplied IDs (`pbxCallId`), unique constraint at the DB level catches duplicates from webhook retries.
- For synthetic IDs, dedup is best-effort — webhook retries arrive with different timestamps, so the DB will see them as distinct rows. Idempotency must come from the caller (e.g. N8N includes a stable `idempotency_key`).

## Phone number conventions

Three forms of the same number coexist and must be converted at boundaries:

| Where                                          | Format                          | Example      |
|------------------------------------------------|---------------------------------|--------------|
| Zadarma webhook payloads (`caller_id`, etc.)   | E.164 with no `+`               | `48539925725`|
| `callLog.clientNumber`, `smsLog.clientNumber`  | E.164 with no `+`               | `48539925725`|
| Twenty `Person.phones.primaryPhoneNumber`      | local part, no country code     | `539925725`  |
| Twenty `Person.phones.primaryPhoneCallingCode` | with `+`                        | `+48`        |

**Matching rule** (calls/SMS to Person): compare last **9 digits** of the log's `clientNumber` against last 9 digits of every Person phone (primary + each `phones.additionalPhones[].number`). 9 digits cover Polish mobiles and most country mobile lengths; fewer false-positives than 7, fewer false-negatives than full-E.164 equality.

The shared helper that does it: `src/modules/zadarma/utils/find-person-by-phone.ts` (`findPersonIdByClientNumber`). Use this — don't write a fresh GraphQL filter at each callsite.

## Date / time conventions

- **Storage**: ISO 8601 UTC with millisecond precision: `2026-05-07T22:15:43.123Z`.
- **Zadarma**: webhook timestamps arrive in UTC as `YYYY-MM-DD HH:MM:SS`. Convert to ISO immediately at the webhook boundary.
- **Display**: Twenty's UI handles user-timezone conversion — store UTC, render local.
- **Synthetic ID timestamp** uses the compact form (`20260507T221543123`) — see ID scheme above.

## applicationVariables

- **Naming**: `SCREAMING_SNAKE_CASE`, scoped by domain prefix (`ZADARMA_USER_KEY`, `N8N_SMS_WEBHOOK_URL`).
- **Secrets**: pass `isSecret: true` for credentials. Twenty masks them in the Settings UI and in metadata API responses.
- **Defaults**: provide a `value:` only for non-secret toggles (e.g. `ZADARMA_TRANSCRIPT_ENABLED: 'true'`). Secrets must default to empty so the user is forced to set them.
- **Description**: write the description as a help-text. The user sees it in the Settings tab.
- **Universal identifier**: every applicationVariable needs its own UUID v4. Same rule as objects — never change after publish.

## Logging

- Use `console.log` / `console.warn` / `console.error`. Twenty captures them and exposes via `yarn twenty logs`.
- Tag every log line with the source in square brackets:
  ```ts
  console.log(`[rescan-orphans] callLogs page=${pageNum} scanned=${scanned} linked=${linked}`);
  console.error('[send-zadarma-sms] crashed:', err);
  ```
- Never log secrets (`ZADARMA_USER_KEY`, `ZADARMA_SECRET`, bearer tokens, full request bodies that include `secret=`).
- For debugging logic-functions in production, prefer returning a `debug: string[]` field in the JSON response over emitting verbose logs.

## Adding new entities

Each kind has a generator under `yarn twenty add <kind>`:

```bash
yarn twenty add object              # new custom object
yarn twenty add field               # field on an existing object
yarn twenty add logicFunction       # webhook / db-event / route trigger
yarn twenty add frontComponent      # custom UI
yarn twenty add view
yarn twenty add navigationMenuItem
yarn twenty add pageLayout
yarn twenty add pageLayoutTab
```

The generator creates the file with a fresh UUID and the right `define*` skeleton. Adjust naming + content; commit.

After any change run:

```bash
yarn twenty build                   # typecheck + manifest build
yarn lint
yarn vitest run                     # see "Testing" below — note the local-uninstall side effect
```

## Testing

- **Unit**: `*.test.ts` next to the source file. Pure functions only. Examples: `src/modules/zadarma/utils/normalize-phone.test.ts`, `src/modules/zadarma/connector/zadarma-signing.test.ts`.
- **Integration**: `src/__tests__/*.integration-test.ts`. Hits a running Twenty server. Currently `schema.integration-test.ts` registers the App and asserts the manifest.

### ⚠️ vitest teardown uninstalls the App from local

The integration test setup writes its own `~/.twenty/config.test.json` with `defaultRemote: local`, calls `appUninstall` at start (clean slate), then again at teardown. After running `yarn vitest run` the App is **gone from `localhost:2020`** — the Settings tab, Person panel, custom views all vanish.

Fix: re-deploy after the test run.

```bash
yarn twenty -r local dev --once
```

The `-r local` is required because the user's default remote is usually `coolify` (production). Without `-r local`, the redeploy targets production.

`coolify` (production) is **not** affected by vitest because the test setup uses its own config file; only the `local` remote is touched.

## Git, commits, branches

- **Branch from `main`**, name with a kind prefix:
  - `feat/<short-description>` — new feature
  - `fix/<short-description>` — bug fix
  - `chore/<short-description>` — refactor, deps, build
  - `docs/<short-description>` — documentation only
- **One feature per branch**, even if it spans several commits. Squash on merge.
- **Commit messages** follow Conventional Commits:
  ```
  feat(orphans): rescan button + counters in Settings; share findPersonIdByClientNumber

  <body explaining why, not what — the diff already shows what>
  ```
- Never `git push --force` to `main`. Force-push is fine on your own feature branches before review.
- Never `git rebase --no-edit`. The flag isn't valid; let `git rebase` open the editor.

## Pull requests

- One PR per issue. Link the issue in the PR description (`Closes #N`).
- Set the milestone to the version the PR targets (`v0.4.0`, `v0.5.0`, …).
- Add labels: `enhancement` / `bug`, plus `area:*` (`area:logic-function`, `area:front-component`, `area:integration`, `area:docs`), plus `priority:*`.
- PR description sections:
  - **Summary** — bullet points, one line each, what changed.
  - **Why** — non-obvious rationale; skip if obvious from the issue.
  - **Test plan** — the `[ ]` checklist of what was verified (build, lint, vitest, manual smoke test on local 2020 / Coolify).
- Self-review before requesting review: `gh pr diff <number>`. Catch typos and dead code.

## Release workflow

1. Merge feature PRs into `main` until the milestone is empty.
2. Bump version in `package.json` (matches the milestone).
3. Tag: `git tag v<version> && git push origin v<version>`.
4. The release workflow in `.github/workflows/release.yml` builds the `.tgz` and attaches it to a GitHub Release.
5. Test installing the published `.tgz` on a clean Twenty 2.2 server before announcing.

## Security

- Never commit `.env`, credentials, API keys, bearer tokens. The `.gitignore` covers the obvious paths; before push, run `git diff main...HEAD` and grep for `ZADARMA_USER_KEY`, `ZADARMA_SECRET`, `Bearer `, `password`, `apiKey`.
- Treat all `applicationVariables` with `isSecret: true` as untrusted from the App's perspective: don't echo them in logs, don't include them in JSON responses, don't put them in the URL query string of an `http.get` (Zadarma signing puts them in the body or HMAC signature, never the URL).
- Webhook handlers must verify Zadarma's HMAC-SHA1 signature before trusting the payload. See `src/modules/zadarma/connector/verify-webhook.ts`.

## When in doubt

- If the rule isn't here, look at how an existing file does it. The codebase is small enough to be self-documenting.
- If two files do it differently, the newer one is canonical (and the older one should be migrated in a separate PR).
- If you genuinely don't know which way to go, open the issue / PR with your best guess and a question, and we'll decide together.
