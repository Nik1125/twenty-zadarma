# AI call enrichment

Vendor-agnostic post-call enrichment for AI-powered calls (Retell, Vapi, etc.).
Adapters running in n8n (or any other automation) push structured AI metrics
onto an existing `callLog` row, deduplicating against the live Zadarma webhook
that already created the row.

## Why a separate endpoint instead of a new callLog

When an AI agent (Retell) places a call through Zadarma's SIP trunk, the call
is **one physical call**, not two. Zadarma's `NOTIFY_END` webhook already
creates the `callLog` row with `pbxCallId`, `clientNumber`, `callStart`,
`duration`, `disposition`, etc. — the telecom layer.

The AI vendor adds another layer: transcript, summary, sentiment, success
self-assessment, agent name, AI infra cost, escalation flag, plus structured
post-call analysis (interest level, action required, action context, key
topics). This endpoint **attaches** that layer to the existing row instead of
creating a duplicate.

> **v0.19.0 schema split** — transcripts now land on dedicated rich-text
> fields (`aiTranscript` for vendor transcripts, `transcript` for Zadarma
> speech-recognition manager-side). Earlier `data.transcript` / `data.summary`
> field names have been renamed to `data.aiTranscript` / `data.aiSummary`,
> and the linked-Note pattern for vendor debug data has been retired —
> everything that should be persisted lives on typed callLog fields.

## Architecture

```
n8n triggers Retell                                     ┌────────────────┐
  └─ POST /v2/create-phone-call                         │   Retell       │
     metadata: { person_id, opportunity_id }            │   agent run    │
                                                        └────────┬───────┘
SIP call routes via Zadarma trunk                                │
internal extension = AI ext (e.g. 103)                           │
                                                                 ▼
Zadarma fires NOTIFY_OUT_END (~12s before Retell)        ┌──────────────┐
  └─ App creates callLog                                  │   Zadarma    │
     { pbxCallId, clientNumber, ourNumber,                │   PBX trunk  │
       callStart, duration, internalExtension: '103' }    └──────────────┘

Retell fires `call_analyzed` webhook to n8n
  └─ n8n adapter:
     1. (optional) Run post-call analyser LLM to extract
        aiInterestLevel / aiActionRequired / aiActionContext / aiKeyTopics
        from the Retell transcript.
     2. POST /zadarma/call-enrichment
        match: { correlationId, fromNumber, toNumber,
                 startTimestamp, windowSeconds: 60,
                 requireExtensions: true }
        data:  { aiVendor: 'retell', aiAgentName, aiSentiment,
                 aiSuccessful, aiTransferred, aiCost,
                 aiTranscript, aiSummary, recordingUrl,
                 aiInterestLevel, aiActionRequired,
                 aiActionContext, aiKeyTopics }
        → 200 { ok, matched: true, callLogId, matchedBy, offsetMs }
```

## Endpoint contract

```http
POST /s/zadarma/call-enrichment
Authorization: Bearer <TWENTY_APP_ACCESS_TOKEN>
Content-Type: application/json
```

### Request body

```ts
{
  match: {
    // Idempotent join key — preferred when available. If a callLog already
    // carries this correlationId, that row is updated. Otherwise the
    // endpoint falls through to fuzzy match (and stamps correlationId
    // during the update).
    correlationId?: string,

    // Required for fuzzy match (or correlationId hit not yet stored).
    fromNumber?: string,        // E.164 with or without "+", e.g. "+48573580808"
    toNumber?: string,          // E.164 with or without "+"
    startTimestamp?: number,    // epoch ms — most reliable for AI calls
    endTimestamp?: number,      // epoch ms — alternative when start unknown
    windowSeconds?: number,     // ± window for fuzzy, default = applicationVariable
                                // CALL_ENRICHMENT_WINDOW_SECONDS (default 90).
                                // Vendor adapters tune: Retell 60, Vapi 30, etc.
    requireExtensions?: boolean // default = true if AI_EXTENSIONS set, false if empty.
                                // When true, only callLogs with internalExtension
                                // in AI_EXTENSIONS list are candidates.
  },
  data: {
    // All optional. Only fields present in the body are written.
    aiVendor?:        string,                    // "retell" | "vapi" | ...
    aiAgentName?:     string,                    // "Amelia v6.2 — Router"
    aiSentiment?:     'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'UNKNOWN',
                                                  // also accepts case-insensitive input
    aiSuccessful?:    boolean,
    aiTransferred?:   boolean,                   // escalated to human or another agent?
    aiCost?:          { amountMicros: number, currencyCode?: string },
                                                  // currencyCode default 'USD'
                                                  // amountMicros = USD * 10^6
    correlationId?:   string,                    // alternative to match.correlationId
    aiTranscript?:    string,                    // RICH_TEXT, plain text accepted
    aiSummary?:       string,                    // RICH_TEXT (mapped to callLog.summary)
    recordingUrl?:    string,                    // sets callLog.recording (LINKS)

    // Post-call analyser output (optional). Each field is silently dropped
    // if malformed (unknown enum, non-array, etc.) — never breaks the rest
    // of the update.
    aiInterestLevel?: number,                    // 1-5; clamped + rounded
    aiActionRequired?:
      | 'NONE'
      | 'SMS_FOLLOWUP'
      | 'EMAIL_OFFER'
      | 'CALLBACK'
      | 'OPERATOR_TASK'
      | 'HUMAN_TRANSFER'
      | 'DO_NOT_CONTACT',
    aiActionContext?: string,                    // ~1-3 sentence rationale
    aiKeyTopics?:     string[],                  // free-form tags;
                                                  // convention `objection:<reason>` for objections
  }
}
```

### Response

```ts
// 200 OK — match + update succeeded
{
  ok: true,
  matched: true,
  callLogId: string,
  matchedBy: 'correlationId' | 'time-window-start' | 'time-window-end' | 'recent-fallback',
  offsetMs: number,           // time-delta between provided ts and matched callStart
  elapsedMs: number
}

// 200 OK — diagnostic, no callLog matched (n8n adapter retries on this)
{
  ok: true,
  matched: false,
  reason: string,
  elapsedMs: number
}

// 200 OK — body validation error
{ ok: false, error: string }
```

> **Note on 404 vs 200 matched:false** — endpoint always returns HTTP 200
> when reachable. The `matched` boolean is the success signal so n8n flows
> can branch on it without HTTP-error handling.

## Match strategies (priority order)

1. **`correlationId`** — explicit join. Fastest. Idempotent (re-runs safe).
2. **`time-window-start`** — `clientNumber + ABS(callStart - startTimestamp) ≤ window`. Filters by `requireExtensions` if applicable.
3. **`time-window-end`** — same but compared against `callStart + duration`. Useful when Retell-style adapter only knows `endTimestamp`.
4. **`recent-fallback`** — most recent unmatched OUT call to that `toNumber` within window from now. Triggered only when no timestamps provided.

All fuzzy strategies filter by `correlationId IS NULL` (so re-runs of the
same enrichment do not double-match an already-enriched row except via
strategy 1).

## Vendor mapping — Retell

n8n `call_analyzed` webhook payload → enrichment body:

| Enrichment field | Retell path |
|---|---|
| `match.correlationId` | `body.call.call_id` |
| `match.fromNumber` | `body.call.from_number` |
| `match.toNumber` | `body.call.to_number` |
| `match.startTimestamp` | `body.call.start_timestamp` |
| `match.endTimestamp` | `body.call.end_timestamp` |
| `match.windowSeconds` | `60` (Retell adds ~10-15s SIP setup latency before its own start_timestamp) |
| `match.requireExtensions` | `true` (assumes `AI_EXTENSIONS` set in App settings) |
| `data.aiVendor` | `'retell'` |
| `data.aiAgentName` | `body.call.agent_name` |
| `data.aiSentiment` | `body.call.call_analysis.user_sentiment.toUpperCase()` |
| `data.aiSuccessful` | `body.call.call_analysis.call_successful` |
| `data.aiTransferred` | `body.call.tool_calls?.some(tc => tc.type === 'agent_swap') \|\| !!body.call.call_analysis.custom_analysis_data.transferred_to` |
| `data.aiCost.amountMicros` | `Math.round(body.call.call_cost.combined_cost * 10000)` (Retell cost is in cents → dollars × 10^6 = cents × 10^4) |
| `data.aiCost.currencyCode` | `'USD'` |
| `data.aiTranscript` | `body.call.transcript` |
| `data.aiSummary` | `body.call.call_analysis.call_summary` |
| `data.recordingUrl` | `body.call.recording_url` |
| `data.aiInterestLevel` | post-call analyser output |
| `data.aiActionRequired` | post-call analyser output |
| `data.aiActionContext` | post-call analyser output |
| `data.aiKeyTopics` | post-call analyser output |

## n8n adapter — paste-ready snippets

### 1. Function node — transform Retell payload

```js
// Input: $input.first().json   (Retell call_analyzed webhook body)
const w = $input.first().json;
const call = w.body?.call ?? w.call ?? w;   // tolerate either wrapping

const transferredTo = call.call_analysis?.custom_analysis_data?.transferred_to;
const transferred =
  (call.tool_calls ?? []).some((tc) => tc.type === 'agent_swap') ||
  Boolean(transferredTo);

const sentimentRaw = call.call_analysis?.user_sentiment;
const sentiment = sentimentRaw ? sentimentRaw.toUpperCase() : null;

return [{
  json: {
    enrichment: {
      match: {
        correlationId: call.call_id,
        fromNumber: call.from_number,
        toNumber: call.to_number,
        startTimestamp: call.start_timestamp,
        endTimestamp: call.end_timestamp,
        windowSeconds: 60,
        requireExtensions: true,
      },
      data: {
        aiVendor: 'retell',
        aiAgentName: call.agent_name,
        aiSentiment: sentiment,
        aiSuccessful: call.call_analysis?.call_successful ?? null,
        aiTransferred: transferred,
        aiCost: typeof call.call_cost?.combined_cost === 'number' ? {
          amountMicros: Math.round(call.call_cost.combined_cost * 10000),
          currencyCode: 'USD',
        } : undefined,
        aiTranscript: call.transcript,
        aiSummary: call.call_analysis?.call_summary,
        recordingUrl: call.recording_url,
        // Optional — populate from a separate post-call analyser node:
        // aiInterestLevel: analyser.interest_level,
        // aiActionRequired: analyser.action_required,
        // aiActionContext:  analyser.action_context,
        // aiKeyTopics:      [...analyser.products, ...analyser.objections.map(o => `objection:${o}`)],
      },
    },
    metadata: call.metadata ?? {},
    rawCall: call,
  },
}];
```

### 2. HTTP Request node — call enrichment

```
Method:        POST
URL:           {{ $env.TWENTY_API_URL }}/s/zadarma/call-enrichment
Authentication: Header Auth — Authorization: Bearer {{ $env.TWENTY_APP_ACCESS_TOKEN }}
Body Content-Type: JSON
Body:          {{ $json.enrichment }}
Timeout:       30s
Retry:         on fail, 3 retries, 5s / 15s / 30s backoff
                (catches the rare race where Retell webhook arrives before Zadarma webhook;
                 also tolerates transient Twenty 5xx)
```

If the response has `matched: false`, the adapter should treat it the same
as a transient failure and retry — Zadarma webhook may not have landed yet.

### 3. (optional) Function node — post-call analyser

If the call is meaningful enough to warrant structured analysis, run an LLM
node against `call.transcript` to produce `aiInterestLevel`,
`aiActionRequired`, `aiActionContext`, `aiKeyTopics`, and merge those into
the enrichment body before step 2. Skip for short / voicemail / cancelled
calls — leave the structured fields empty in those cases.

> Note: the linked-Note pattern (separate `createNote` + `createNoteTarget`
> for vendor debug dumps) was retired in v0.19.0. Anything worth persisting
> goes on typed callLog fields. If you need raw vendor JSON for replay /
> debug, archive it externally — out-of-scope for this App.

## Application variables

| Variable | Default | Range | Purpose |
|---|---|---|---|
| `AI_EXTENSIONS` | `''` (empty) | comma-separated digits, e.g. `"103,105"` | Internal extensions that route to AI agents. Filters fuzzy match candidates. Empty = no filter. |
| `CALL_ENRICHMENT_WINDOW_SECONDS` | `90` | `1–600` | Default fuzzy window. Per-request `match.windowSeconds` overrides. |

Manage via *Settings → Zadarma → Custom tab* (when published) or directly
via the standard Settings → Applications → Zadarma → Variables tab.

## Dashboard ideas

With the structured fields, Twenty `group_by` enables:

- **AI agent leaderboard** — group by `aiAgentName`, count + avg(aiSuccessful).
- **Sentiment trend** — group by `callStart` week + `aiSentiment`.
- **Transfer rate** — `count(aiTransferred=true) / count(aiVendor IS NOT NULL)`.
- **Cost per agent** — group by `aiAgentName`, sum(aiCost).
- **AI vs human comparison** — split: `aiVendor IS NULL` (human) vs `aiVendor IS NOT NULL`, compare avg duration / disposition / negative-sentiment-rate.
- **Cost waterfall** — `cost + aiCost = total cost per call`, group by month.
- **Hot-lead funnel** — filter `aiInterestLevel >= 4`, group by `aiActionRequired`, age = now - callStart. Catches leads in `EMAIL_OFFER` / `CALLBACK` / `OPERATOR_TASK` that haven't been worked yet.
- **Action backlog** — count callLogs by `aiActionRequired` for the current day; surfaces unhandled `OPERATOR_TASK` / `HUMAN_TRANSFER`.
- **Topic frequency** — full-text search `aiKeyTopics` for product / objection tags to track what dominates conversations week-over-week.

## Security

- Endpoint requires Bearer auth (`TWENTY_APP_ACCESS_TOKEN`). No anonymous calls.
- Body content is opaque to the App from a domain perspective — the App
  validates structure but does not interpret business meaning. Domain
  validation lives in n8n adapter and Twenty workspace.
- The endpoint never echoes the bearer token, never logs `data.aiTranscript`
  contents in full, only field names + lengths in the success log line.

## Out of scope

- **Vendor SDK integration** — App never calls Retell/Vapi APIs directly.
  Only receives normalised payloads from adapters.
- **Recording fetch / re-host** — recording URLs are stored as-is. AI
  vendor's retention policy applies. To preserve permanently, n8n adapter
  can download + push to your own storage and replace the URL.
- **Linked Note for vendor debug** — retired in v0.19.0. Anything worth
  persisting lives on typed callLog fields. Archive raw vendor JSON
  externally if needed for replay.
- **Real-time enrichment** — endpoint is post-call only. For live in-call
  data (transfer triggers, mid-call signals), a separate websocket or
  fast-path endpoint would be needed (not planned).
