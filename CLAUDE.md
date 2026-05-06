## Project

Twenty App for Zadarma telephony integration. Distributed as a portable `.tgz` to be installed on any Twenty server (target: Coolify-hosted Twenty 2.2.0).

**Server compatibility**: pinned to Twenty `>=2.2.0` via `engines.twenty` in `package.json`. Bumping the SDK requires re-checking against this minimum.

**Production**: deployed at `https://twentycrm-coolify.mikidev.app/`. Local dev mirror runs in WSL2 against `yarn twenty server` on `:2020`.

## Architecture (verified working)

```
┌────────────────────────────────────────────────────────────┐
│ Zadarma cabinet                                            │
│  ├─ "O połączeniach" webhook → App PBX handler             │
│  ├─ "O zdarzeniach"  webhook → App events handler          │
│  └─ /v1/sms/send/   ← signed call from N8N                 │
└────────────────────────────────────────────────────────────┘
                       │ inbound                  ▲ outbound
                       ▼                          │
┌─────────────────────────────────┐   ┌────────────────────────┐
│ Twenty App (this project)       │   │ N8N (user's external)  │
│                                 │   │                        │
│ Inbound webhooks:               │   │ /webhook/zadarma-out:  │
│  /s/zadarma/pbx-webhook   ──┐   │   │   1. sign Zadarma      │
│  /s/zadarma-event-webhook ──┼─→ │   │   2. POST /sms/send/   │
│        │                    │   │   │   3. POST Twenty       │
│        ▼                    │   │   │      createSmsLog      │
│  callLog / smsLog records   │   │   │   4. Respond 204       │
│  zadarmaWebhookEvent (audit)│   │   └────────────────────────┘
│        │                    │   │              ▲
│  Person ←── relations ──────┘   │              │ <form action>
│        │                                       │
│  zadarma-person-panel frontComp ───────────────┘
│  (chat history + native HTML form)              
└─────────────────────────────────┘
```

**Why N8N for outbound SMS**: Twenty 2.2 frontComponent runs in a Web Worker + Remote DOM that strips `<input>` value from event handlers. The only way to get user-typed text out of the worker is a native browser form submit — which means the form action has to be a public URL (N8N's webhook), not a logic-function (auth would block frontComponent fetches anyway).

## Where things live

- `src/objects/` — `callLog`, `smsLog`, `zadarmaWebhookEvent`
- `src/fields/` — bidirectional Person↔callLog and Person↔smsLog relations
- `src/views/` — index views for each object
- `src/navigation-menu-items/` — sidebar entries (VIEW type, scoped to Zadarma App, but visible in main sidebar in 2.2)
- `src/logic-functions/` — webhook handlers + backward-link triggers
- `src/front-components/zadarma-person-panel.front-component.tsx` — the panel itself; pinned `<Command>` button on Person; chat-style history + native HTML form for sending
- `src/modules/zadarma/connector/` — `signZadarmaRequest` / `verifyZadarmaWebhook` (signing, used by NOTIFY_RECORD URL fetch)
- `src/modules/zadarma/utils/` — `normalizePhone`, `formatTranscript`, `linkOrphansToPersonByPhone`, `logWebhookEvent`
- `.claude/skills/zadarma-api/` — Zadarma API skill (signing, endpoints, payload shapes)
- `YARN.md` — `yarn twenty` command reference
- `../twenty-apps-reference/` — read-only sample apps from twentyhq/twenty (sibling, NOT inside the project root — Twenty CLI scans the whole project)

## applicationVariables (set in Settings → Applications → Zadarma after install)

- `ZADARMA_USER_KEY` (secret) — used by NOTIFY_RECORD handler to fetch the recording URL
- `ZADARMA_SECRET` (secret) — same
- `ZADARMA_TRANSCRIPT_ENABLED` (`true` / `false`) — toggle SPEECH_RECOGNITION processing
- `N8N_SMS_WEBHOOK_URL` — full URL of the N8N webhook the chat form submits to

## Twenty 2.2 SDK constraints to remember

These bit us during development. See the user's `feedback_twenty_app_sdk_2_2_quirks.md` memory for the full list. Highlights:

- **`<input>` events do NOT carry the typed value into the worker** — neither `e.value` nor `e.target.value`. Don't try to capture text via React events; use a native `<form action="…" method="POST">`.
- **Form server must respond 204** to keep the user on the Twenty page after submit. Anything else navigates the page.
- **iframe in frontComponent is hard-sandboxed** to nothing — no scripts, no forms. Page-layout iframe widgets DO have `allow-scripts allow-forms allow-same-origin` but you can't add widgets to a Person page.
- **`definePageLayout({objectUniversalIdentifier: person})` is silently ignored** — Apps can't define a wholesale replacement layout for a standard object. **But `definePageLayoutTab` to ADD a tab to one DOES work** (verified empirically on Person). Pass the hardcoded standard-layout UUID as `pageLayoutUniversalIdentifier` (Person = `20202020-a102-4002-8002-ae0a1ea11002`, from upstream `twenty-standard-application/utils/page-layout-config/standard-person-page-layout.config.ts`). The `SYSTEM_OBJECT_TABS` whitelist in `PageLayoutTabsRenderer.tsx` only filters when the layout id matches `DEFAULT_RECORD_PAGE_LAYOUT_ID`; Person uses its own id so App-defined tabs render. See `src/page-layout-tabs/zadarma-person-tab.page-layout-tab.ts` for working example (CANVAS layoutMode + single FRONT_COMPONENT widget reusing `zadarma-person-panel`).
- **`findManyApplications` (no filter) throws if any app has `applicationVariables: null`** — schema bug. Use `findOneApplication(universalIdentifier: "…")` instead.
- **Logic-function response is always JSON 200** — cannot return 204/redirects.
- Zadarma recording URLs default to `lifetime=1800` (30 min) — always pass `lifetime=5_184_000` (60 days max).

## Twenty App rules (non-obvious)

- All `universalIdentifier`s must be valid **UUID v4**. Use `uuidgen`, never hand-craft. Never change a published one — that breaks installs on existing instances.
- Every `defineObject` should have an associated `defineView` and a `defineNavigationMenuItem`.
- Front-components run in **Web Workers via Remote DOM** — a constrained React subset.
- Logic functions run in **isolated Node.js processes** — they only access workspace data through the typed `CoreApiClient` / `MetadataApiClient` (injected via `process.env.TWENTY_API_URL` + `TWENTY_APP_ACCESS_TOKEN`).

## TypeScript / React conventions

- **No `any`**. Use `unknown` + narrowing or precise types.
- **Types over interfaces**, except when extending third-party interfaces.
- **String literal unions** over enums.
- **Named exports only**, no default exports — except `export default defineLogicFunction(...)` etc., which Twenty's build step requires.
- **Functional components only**.
- Files: `kebab-case` with descriptive suffixes — `call-log.object.ts`, `handle-zadarma-webhook.logic-function.ts`, `zadarma-settings.front-component.tsx`.
- Comments: `//` only, no JSDoc. Explain WHY, not WHAT.
- Imports: external libs first, then `src/...` absolute, then relative.

## Testing

- Vitest is preconfigured. Unit tests next to the file (`*.test.ts`); integration tests under `src/__tests__/*.integration-test.ts`.
- Existing tests: `src/modules/zadarma/utils/normalize-phone.test.ts`, `src/modules/zadarma/connector/zadarma-signing.test.ts` (signing round-trip with `signZadarmaRequest` ↔ `verifyZadarmaWebhook`).

## Commands

See `YARN.md`. Short version: `yarn twenty server start` (local dev), `yarn twenty dev --once` (push current code to active remote), `yarn twenty build --tarball` + `yarn twenty deploy` + `yarn twenty install` (deploy to Coolify).
