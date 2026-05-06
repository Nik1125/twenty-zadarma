# twenty-zadarma

A [Twenty CRM](https://twenty.com) app that turns [Zadarma](https://zadarma.com) calls and SMS into Twenty records, and lets a manager send SMS without leaving the Twenty UI. Fully native — no external services required (no N8N, no relay).

## Features

- **Inbound / outbound calls** — `NOTIFY_END` / `NOTIFY_OUT_END` / `NOTIFY_RECORD` Zadarma webhooks logged as `callLog` records, auto-linked to the matching `Person` by phone number, with a 60-day-lifetime recording link.
- **Inbound SMS** — Zadarma `SMS` events logged as `smsLog` records, auto-linked.
- **Outbound SMS from Person panel** — pinned "Zadarma" Command on every Person + a dedicated tab on the Person record-show page (next to Calendar). Chat-style history, auto-grow textarea, signed Zadarma `/v1/sms/send/` call from the Twenty App with Bearer auth.
- **Speech recognition transcripts** — `SPEECH_RECOGNITION` events parsed with speaker labels (Operator / Client) when stereo recording is enabled in Zadarma.
- **Custom Settings tab** — connection test (balance / tariff / numbers), default-sender DID dropdown, transcript-enabled checkbox, webhook URL display + copy + echo test, quick setup checklist with Zadarma marketplace links.
- **Theme-aware** — all UI follows Twenty's CSS theme variables (light / dark switch automatically).

## Requirements

- Twenty CRM **`>= 2.2.0`** running somewhere you control (self-hosted, Coolify, Docker, etc.).
- The Twenty server must have **`LOGIC_FUNCTION_TYPE=LOCAL`** in its environment — see [Server prerequisites](#server-prerequisites) below. Without this, every endpoint of this app returns `LOGIC_FUNCTION_EXECUTION_ERROR`.
- A **Zadarma** account with API access ([USER_KEY + SECRET from the marketplace](https://my.zadarma.com/marketplace/#tab-apiKeys)).
- On the machine you install from: **Node `^24.5.0`** and **Yarn `>= 4`** (the project uses Corepack).

## Server prerequisites

Twenty defaults `LOGIC_FUNCTION_TYPE` to `DISABLED`, which makes every Twenty App's HTTP route, webhook, and database trigger crash with `LOGIC_FUNCTION_EXECUTION_ERROR`. Before installing this app, make sure the Twenty server has logic-function execution enabled.

**Self-hosted (Docker / Coolify / Compose) — recommended:**

Add the following environment variable to your Twenty server and restart the container:

```env
LOGIC_FUNCTION_TYPE=LOCAL
```

This makes Twenty execute logic-functions inside its own container — no AWS, no extra services. The `LAMBDA` driver is for multi-tenant SaaS deployments only and needs AWS configuration; ignore it for self-hosted.

**Coolify** — open the Twenty service, go to *Environment Variables*, add `LOGIC_FUNCTION_TYPE=LOCAL`, and click *Restart*.

**Twenty Cloud (twenty.com)** — already enabled, no action needed.

You can verify it's working by hitting your Twenty server's healthz before installing — but a clearer check is to install this app and load the Settings → Zadarma tab. If you see balance / tariff data, logic-functions are running.

## Install

```bash
# 1. Clone the repo and check out the latest release
git clone https://github.com/Nik1125/twenty-zadarma.git
cd twenty-zadarma
git checkout v0.3.0       # replace with the latest tag from GitHub Releases
yarn install --immutable

# 2. Register your Twenty server with the Twenty CLI (one-time per server)
yarn twenty remote add --as my-twenty \
  --api-url https://your-twenty-host \
  --api-key <api-key>     # Twenty UI: Settings → Developers → API Keys → Create
yarn twenty remote switch my-twenty

# 3. Build, deploy, and install
yarn twenty build --tarball
yarn twenty deploy
yarn twenty install
```

Updating to a newer version later: `git fetch --tags && git checkout <new-tag> && yarn install --immutable && yarn twenty build --tarball && yarn twenty deploy && yarn twenty install` (Twenty CLI rejects deploys whose `package.json` version is not strictly greater than the installed one).

## Configure

After install, open your Twenty workspace → **Settings → Applications → Zadarma**.

### applicationVariables (default tab)

| Variable | Notes |
|---|---|
| `ZADARMA_USER_KEY` | secret — from [Zadarma marketplace](https://my.zadarma.com/marketplace/#tab-apiKeys) |
| `ZADARMA_SECRET` | secret — from the same place |
| `DEFAULT_SENDER_DID` | leave blank, set it from the dropdown in the custom Zadarma Settings tab once balance loads |
| `ZADARMA_TRANSCRIPT_ENABLED` | `true` / `false` — toggle `SPEECH_RECOGNITION` processing for call transcripts |

### Custom Zadarma Settings tab

Switch to the **Zadarma** tab inside Settings. You will see:
- balance / tariff / direct numbers (loaded via the `/s/zadarma/info` endpoint)
- a **DID dropdown** — pick the number outbound SMS should be sent from
- a **Transcript** checkbox
- both **webhook URLs** with Copy + Test buttons
- a quick setup checklist with links into the Zadarma marketplace

### Wire up Zadarma webhooks

In your [Zadarma cabinet](https://my.zadarma.com/marketplace/) → API & Webhooks, point the two webhooks at the URLs shown on the Settings tab:

- **"O połączeniach" / "About calls"** → `https://<your-twenty-host>/s/zadarma/pbx-webhook`
- **"O zdarzeniach" / "About events"** → `https://<your-twenty-host>/s/zadarma-event-webhook`

Trigger a test call and a test SMS in the Zadarma cabinet — the corresponding `callLog` / `smsLog` records should appear in Twenty within a few seconds.

## Use

- Open any **Person** record. The right side panel has a **Zadarma** Command button (chat history + send box). The Person record-show page also has a **Zadarma** tab in the header tabs row, next to *Calendar* — both render the same chat panel.
- Type a message and press **Send**. The app signs and POSTs to Zadarma's `/v1/sms/send/`, creates an `smsLog` record, and refreshes the chat.
- Inbound SMS arrive via the events webhook and show up automatically.
- Calls flow into the **All calls** view in the left sidebar; SMS in the **All SMS** view.

## Troubleshooting

**Settings → Zadarma test fails / `LOGIC_FUNCTION_EXECUTION_ERROR` everywhere** — your Twenty server is on the default `DISABLED` driver. See [Server prerequisites](#server-prerequisites).

**SMS test in the Zadarma cabinet returns "couldn't reach webhook"** — Zadarma's *Test* button calls from the public internet, so a `localhost:2020` Twenty won't be reachable. Either expose your dev Twenty via a tunnel (Cloudflare Quick Tunnel, ngrok, etc.) or test by triggering a real call/SMS to the configured DID.

**Balance / numbers don't load on the custom Settings tab** — usually wrong API key/secret. Re-check them from [my.zadarma.com/marketplace/#tab-apiKeys](https://my.zadarma.com/marketplace/#tab-apiKeys); these values are pasted into the default Settings tab fields and stored as `isSecret: true` in Twenty (the UI redacts them after save, that's expected).

**Recording links 404 after a while** — Zadarma's recording URLs default to a short TTL. This app passes `lifetime=5_184_000` (60 days, max), so links should stay valid for two months. After that the call_id can be re-signed via `/v1/pbx/record/request/`.

## Local development

```bash
yarn install
yarn twenty server start    # one-time: starts a local Twenty at :2020
yarn twenty dev             # watch mode — pushes changes on save
yarn twenty dev --once      # one-shot push
```

See [`YARN.md`](./YARN.md) for the full Twenty CLI reference.

## Architecture

```
Zadarma cabinet
  ├─ "O połączeniach" webhook → /s/zadarma/pbx-webhook       (App, anonymous)
  ├─ "O zdarzeniach"  webhook → /s/zadarma-event-webhook     (App, anonymous)
  └─ /v1/sms/send/    ← signed by /s/zadarma/send-sms        (App, Bearer auth)
                                  ↑
zadarma-person-panel ─────────────┘  (Twenty App, runs in Web Worker;
                                      Bearer token from
                                      process.env.TWENTY_APP_ACCESS_TOKEN)
```

| Component | Role |
|---|---|
| `callLog`, `smsLog` objects | bidirectional `Person.callLogs` / `Person.smsLogs` relations |
| `handle-zadarma-pbx-webhook` | `NOTIFY_END` / `NOTIFY_OUT_END` / `NOTIFY_RECORD` → `callLog` + auto-link |
| `handle-zadarma-event-webhook` | inbound SMS + speech-recognition transcript |
| `send-zadarma-sms` | signs Zadarma `/v1/sms/send/`, creates `smsLog`, returns JSON 200 |
| `get-zadarma-info` | balance / tariff / direct numbers proxy for the Settings tab |
| `link-orphans-on-person-(created\|updated)` | DB-event-triggered backward auto-link |
| `zadarma-person-panel` front-component | SMS chat panel — pinned Command + Person record-show tab |
| `zadarma-settings` front-component | custom Settings tab |

## License

MIT — see [`LICENSE`](./LICENSE).

Zadarma is a trademark of Zadarma OOO; this project is not affiliated with or endorsed by Zadarma.
