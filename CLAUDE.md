# Twenty Zadarma App

Twenty CRM app for Zadarma telephony. **Fully native** — no external services (no N8N, no relay).
Production: `https://twentycrm-coolify.mikidev.app/`. Local dev: `yarn twenty server start` on `:2020`. `engines.twenty` pinned `>=2.2.0` (bumping the SDK = re-check the minimum).

## Architecture (one paragraph)

Inbound Zadarma webhooks (`NOTIFY_END` / `NOTIFY_OUT_END` / `NOTIFY_RECORD` / `SMS` / `SPEECH_RECOGNITION`) → `callLog` / `smsLog` records → auto-linked to a `Person` by last-9-digit phone-suffix match (helper: `findPersonIdByClientNumber`). Outbound SMS: Person panel form → `POST /s/zadarma/send-sms` logic-function (Bearer auth) signs the Zadarma `/v1/sms/send/` call and creates the `smsLog`. Settings → Zadarma exposes connection diagnostics and an **Orphan rescan** button that links any `personId IS NULL` records against every Person phone (primary + `additionalPhones[]`).

## Index — where to look

CLAUDE.md is a guiding star, not the source of truth. Each row below points to the canonical document for that topic; do not duplicate content here.

| Topic | Source of truth |
|---|---|
| Conventions, dev setup, naming, ID schemes, phone format, vitest gotcha, PR rules | `CONTRIBUTING.md` |
| Historical-data migration (Zadarma → Twenty Import) | `docs/IMPORT.md` + `scripts/transformers/` |
| `yarn twenty` CLI command reference | `YARN.md` |
| Twenty SDK 2.2 quirks (frontComponent, applicationVariables, page-layout tabs, server prereqs) | skill `twenty-app-sdk-quirks` |
| Zadarma API (HMAC signing, endpoints, webhook signature verification) | skill `zadarma-api` |
| Bulk-export Zadarma calls + SMS into canonical CSV | skill `zadarma-bulk-export` |
| Publishing this App as a public OS release | skill `twenty-app-publishing` |
| Object schemas (`callLog`, `smsLog`) | `src/objects/*.object.ts` |
| Upstream Twenty reference apps | `../twenty-apps-reference/` (sibling, not in project root — Twenty CLI scans the whole project) |

## Critical facts (load these first)

- **Server prerequisite**: the Twenty server must have `LOGIC_FUNCTION_TYPE=LOCAL` (or `LAMBDA` for SaaS). Default `DISABLED` makes every endpoint of this App crash with `LOGIC_FUNCTION_EXECUTION_ERROR`.
- **Remotes**: `local` (`http://localhost:2020`, dev) and `coolify` (production). Default is `coolify` — pass `-r local` to override; never deploy to `coolify` unintentionally.
- **`vitest` teardown uninstalls the App from `local`** — restore with `yarn twenty -r local dev --once`. See CONTRIBUTING.md §Testing.
- **Update path**: `yarn twenty deploy + install` upserts by `universalIdentifier`. Data + workspace-added custom fields survive. `uninstall` drops everything; Coolify Postgres backup is the safety net.
- **Never change a published `universalIdentifier`** — it's the migration key. Generate new ones with `uuidgen`.
