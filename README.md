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

- Twenty CRM `>=2.2.0` (engines pinned in `package.json`).
- A Zadarma account with API access (USER_KEY + SECRET from the [Zadarma marketplace](https://my.zadarma.com/marketplace/#tab-apiKeys)).
- Node `^24.5.0`, Yarn `>=4.0.2`.

## Install on a Twenty server

```bash
# 1. Clone or download a release tarball
git clone https://github.com/Nik1125/twenty-zadarma.git
cd twenty-zadarma

# 2. Install dependencies
yarn install

# 3. Point the Twenty CLI at your Twenty workspace
cp .env.example .env   # then fill in TWENTY_API_URL and TWENTY_API_KEY

# 4. Build the app tarball and install it on your Twenty server
yarn twenty build --tarball
yarn twenty deploy
yarn twenty install
```

After install, open Twenty → Settings → Applications → Zadarma and fill in the four `applicationVariables`:

| Variable | Notes |
|---|---|
| `ZADARMA_USER_KEY` | secret — from Zadarma marketplace |
| `ZADARMA_SECRET` | secret — from Zadarma marketplace |
| `DEFAULT_SENDER_DID` | sender phone number for outbound SMS (managed via the custom Settings tab dropdown) |
| `ZADARMA_TRANSCRIPT_ENABLED` | `true` / `false` — toggle SPEECH_RECOGNITION processing |

Then in your Zadarma cabinet point the two webhooks at the URLs shown on the custom Settings tab:

- **"O połączeniach" / "About calls"** → `<YOUR_TWENTY>/s/zadarma/pbx-webhook`
- **"O zdarzeniach" / "About events"** → `<YOUR_TWENTY>/s/zadarma-event-webhook`

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
