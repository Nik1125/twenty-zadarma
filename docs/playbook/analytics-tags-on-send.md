---
purpose: Tag every outbound SMS with structured analytics axes (category, source, templateName, campaignId) so Twenty's native group_by dashboards can answer real questions without custom code.
applies_when: An automation (n8n, Twenty Workflow, external API) sends SMS via /s/zadarma/send-sms and the team wants to slice volume / cost / response data by message type, sender system, template, or campaign.
related: [optout-via-n8n-llm.md, voice-agent-context-queries.md]
---

# Analytics tags on outbound SMS

## Problem

Out of the box, every `smsLog` row looks the same — `direction`, `clientNumber`, `body`, `cost`. There's no built-in way to ask "how many appointment reminders did we send last month?" or "what's the n8n vs operator volume split?" or "which campaign produced the highest delivery rate?". `createdBy` is useless for sender attribution because every row reports `name: "Zadarma"` (the App is the middleman that wrote the row).

## Solution

Pass four optional analytics tags on every `POST /s/zadarma/send-sms` call. The endpoint persists them on the resulting `smsLog`. Twenty's standard list-view filtering and group_by dashboards then work natively — no custom views, no SQL, no extra schema.

| Field | Type | Purpose |
|---|---|---|
| `category` | SELECT — TRANSACTIONAL / MARKETING / REMINDER / FOLLOWUP / CONFIRMATION / OTHER | Coarse "what kind of message" axis |
| `source` | SELECT — CHAT_PANEL / N8N / TWENTY_WORKFLOW / EXTERNAL_API / INBOUND / OTHER | Who/what triggered the send |
| `templateName` | TEXT, free-form | Caller-defined template identifier (e.g. `appointment_reminder_pl`) |
| `campaignId` | TEXT, free-form | Batch identifier for marketing rollouts (e.g. `spring_2026_promo`) |

The chat panel auto-tags `source: CHAT_PANEL`. The inbound webhook auto-tags `source: INBOUND`. n8n / Twenty Workflows / external API callers pass values explicitly.

## Steps

### 1. Tagged send from n8n

```bash
curl -X POST 'https://your-twenty/s/zadarma/send-sms' \
  -H 'Authorization: Bearer YOUR_WORKSPACE_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "to": "{{ $node["LoadPerson"].json.phones.primaryPhoneNumber }}",
    "from": "{{ $env.ZADARMA_SENDER_DID }}",
    "message": "{{ $node["RenderTemplate"].json.body }}",
    "personId": "{{ $node["LoadPerson"].json.id }}",
    "category": "REMINDER",
    "source": "N8N",
    "templateName": "appointment_reminder_pl",
    "campaignId": "may2026_appointments"
  }'
```

Tip — the same cURL is available paste-ready in **Settings → Applications → Zadarma → Zadarma tab → SMS send endpoint** with the URL pre-filled.

### 2. Tagged send from a Twenty Workflow

Use a "Webhook" action node:

- URL: `{{secret.zadarmaSendSmsUrl}}` (store in workspace secrets)
- Method: POST
- Headers: `Authorization: Bearer {{secret.workspaceApiKey}}`, `Content-Type: application/json`
- Body: same shape as cURL above. Set `source: TWENTY_WORKFLOW`.

### 3. Native group_by dashboards

Once tagged rows exist, open **All SMS → group by → Category** to get monthly counts per category. Add a filter `Created at After 30 days ago` to scope. Save as a view.

For per-template effectiveness:

1. Open **All SMS**.
2. Filter `direction = OUT`, `Created at After 30 days ago`.
3. Group by `Template name`.
4. Add a sum column on `Cost` to see spend per template.

For sender attribution (manager workload review):

1. Open **All SMS**.
2. Filter `direction = OUT`.
3. Group by `Source`.

### 4. Campaign rollout tracking

When launching a marketing batch, pick a `campaignId` once and reuse it on every send in that batch. Then:

```graphql
{
  smsLogs(filter: { campaignId: { eq: "spring_2026_promo" } }) {
    edges { node { id status cost { amountMicros } } }
  }
}
```

gives the full batch in one query. Aggregate `status` to compute delivery rate, sum `cost.amountMicros` for total spend.

## Variants

### Variant — humanised SMS via LLM that still gets tagged

Anti-spam pattern: render template body in n8n → run an LLM "humaniser" on it → send via `/s/zadarma/send-sms` with the humanised body. Crucially, **still pass `templateName`** so the resulting row is tagged with the original template, even though the actual body is unique. Group_by analytics work on intent, not on text.

### Variant — caller bypasses tags entirely

Old callers that don't supply tags get `category: OTHER`, `source: OTHER`, `templateName: null`, `campaignId: null` automatically. No breaking change for any existing integration.

### Variant — unknown enum values

If a caller passes `"category": "NEWSLETTER"` (not in the enum), the endpoint stores `OTHER` instead of failing the send. This is intentional: a caller on a newer client speaking values we have not minted yet should still get the SMS through. Trade-off: typos silently degrade to `OTHER`. Audit your caller list periodically with `{ smsLogs(filter: { category: { eq: "OTHER" }, source: { neq: "OTHER" }}) { ... } }` to catch this.

## Why this approach

**Considered: a `/send-template` endpoint with an `SMS_TEMPLATES` JSON applicationVariable that the App renders server-side.** Rejected during planning round 2:

- Multi-language switching, conditional bodies, and LLM-humanise-against-spam-filters all already work in n8n. A mini-engine inside the App would duplicate that poorly.
- A JSON-in-an-applicationVariable editing UX is bad — no syntax highlighting, no `{{var}}` validation, no preview. Edit-by-paste is a foot-gun.
- Workspaces have different template languages, naming conventions, and ownership policies. Hardcoding any of them in the App couples the App to one workspace.

**Considered: deriving sender from `createdBy` instead of a `source` field.** Rejected because every smsLog row's `createdBy` is the App's actor (the App is the middleman that calls `createSmsLog`). Forwarding the original caller's identity into the internal CoreApiClient is fragile across SDK updates and gives no project-meaningful axis (operators don't think in JWT-actor terms — they think in "n8n vs chat panel vs Twenty Workflow" terms).

**Considered: a separate `Campaign` object with `Campaign → smsLogs` relation.** Rejected for v1: free-form text on `smsLog.campaignId` covers 90% of the use cases (group_by analytics, batch tracking) without adding object-management overhead. If a workspace later wants Campaign as a first-class object with budget / start-end dates / owner, they can add it as a custom object via Twenty UI and PATCH `smsLog.campaignId` to match — the existing tag does not block that future model.

The split is: **structure** stays in the schema (typed enums, free-form text fields), **content** stays in n8n / Twenty Workflows (template bodies, language switching, LLM rewriting), **enforcement** stays in the App (opt-out guard, signed Zadarma calls, smsLog persistence). Each layer keeps doing what it's good at.
