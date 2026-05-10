# n8n workflow templates

Three reference workflows that wire this App to your n8n instance. Copy the
node configurations into n8n, set your credentials (Twenty Bearer token,
your LLM provider, your Zadarma keys), and you have a working pipeline that
matches the architecture documented in
[`docs/AI_ENRICHMENT.md`](../../docs/AI_ENRICHMENT.md) and
[`docs/AI_BIOGRAPHY.md`](../../docs/AI_BIOGRAPHY.md).

The walkthroughs below are paste-ready: each node block lists every field
n8n needs and the JS / GraphQL body. They are not fully-bundled `.json`
exports — pasting node-by-node lets you adapt to your own naming and
credential setup as you go. (Full `.json` exports are tracked in #54 as a
follow-up after this README pattern has been validated end-to-end against
production data.)

## Prerequisites

| Requirement | Where it lives |
|---|---|
| n8n instance reachable from your Twenty server (or vice versa via webhook) | self-hosted n8n / n8n.cloud |
| Twenty App access token | `Settings → Applications → Zadarma → Access tokens` (create one) |
| LLM provider creds (OpenAI / OpenRouter / Anthropic / etc.) | n8n credentials |
| `LOGIC_FUNCTION_TYPE=LOCAL` (self-hosted Twenty) | Twenty server `.env` — required, the App's endpoints fail without it |
| The markdown→BlockNote helper from [`docs/SNIPPETS.md`](../../docs/SNIPPETS.md) | copied into a Function node in each flow |

## Universal invariants

Every flow that writes to Twenty's RICH_TEXT v2 fields (`aiBiography`,
`aiTranscript`, `summary`, `transcript`) **must** send both `markdown` and
`blocknote`. Markdown-only writes render as raw plaintext with `**` / `##`
visible until the operator manually edits the field. Use the helper in
[`docs/SNIPPETS.md`](../../docs/SNIPPETS.md) — drop the `markdownToBlocknote`
function into a Function node, call it on the LLM output, then send the
result unchanged in your GraphQL mutation.

For App endpoints (`/zadarma/call-enrichment`), the App now wraps the
conversion server-side (v0.22+) — callers send plain markdown strings and
the App produces the dual payload. Direct Twenty GraphQL mutations from
n8n must convert client-side.

---

## 1. Post-call analyser

**Trigger**: Retell / Vapi / your AI vendor's `call_analyzed` webhook.

**Goal**: extract structured analysis from the transcript and PATCH it onto
the matching callLog via this App's `/zadarma/call-enrichment` endpoint.

### Flow

```
Webhook (POST from your AI vendor)
  └─ Function: extract Retell/Vapi payload, normalise transcript
  └─ AI Agent: post-call analyser (structured output: interest, action, topics)
  └─ Function: merge AI fields into enrichment body
  └─ HTTP Request: POST /s/zadarma/call-enrichment
```

### Node 1 — Webhook trigger

```
Method:        POST
Path:          /retell-call-analyzed
Response Mode: Last Node
```

### Node 2 — Function: normalise vendor payload

Use the snippet under §"n8n adapter — paste-ready snippets" in
[`docs/AI_ENRICHMENT.md`](../../docs/AI_ENRICHMENT.md). It accepts the raw
Retell `call_analyzed` body and returns a clean `enrichment` object plus
the bare `transcript` string the analyser AI will work on.

### Node 3 — AI Agent: post-call analyser

```
System prompt:
  You are a conversation classifier. Given a call transcript, output a
  single JSON object with keys:
    interest_level      integer 1..5      // 1=cold/refusal, 5=hot/buying
    action_required     enum              // NONE | SMS_FOLLOWUP | EMAIL_OFFER
                                          // | CALLBACK | OPERATOR_TASK
                                          // | HUMAN_TRANSFER | DO_NOT_CONTACT
    action_context      string ≤2 sent    // why this action, in PL
    key_topics          string[]          // 1-5 short tags, e.g.
                                          //   ["price", "objection:no-time"]
  Output JSON only, no prose, no markdown fences.

User prompt:
  Transcript:
  {{ $json.rawCall.transcript }}
```

Connect this to your preferred LLM model (OpenRouter Gemini Flash works at
~$0.001/call; GPT-4o-mini, Claude Haiku, all fine).

### Node 4 — Function: merge analyser output into enrichment body

```js
// Merge the analyser JSON into the enrichment payload from Node 2.
const enrichment = $('Function: normalise vendor payload').first().json.enrichment;
const analyser = JSON.parse($input.first().json.output);

const objections = (analyser.key_topics ?? []).filter((t) => t.startsWith('objection:'));
const products = (analyser.key_topics ?? []).filter((t) => !t.startsWith('objection:'));

return [{
  json: {
    enrichment: {
      ...enrichment,
      data: {
        ...enrichment.data,
        aiInterestLevel: analyser.interest_level,
        aiActionRequired: analyser.action_required,
        aiActionContext: analyser.action_context,
        aiKeyTopics: [...products, ...objections],
      },
    },
  },
}];
```

### Node 5 — HTTP Request: call enrichment

```
Method:                 POST
URL:                    {{ $env.TWENTY_API_URL }}/s/zadarma/call-enrichment
Authentication:         Header Auth — Authorization: Bearer {{ $env.TWENTY_APP_ACCESS_TOKEN }}
Content-Type:           application/json
Body (JSON expression): {{ $json.enrichment }}
Timeout:                30s
Retry on fail:          3 retries / 5s,15s,30s backoff
```

The App handles RICH_TEXT conversion server-side (v0.22+) — `aiTranscript`
and `aiSummary` go in as plain markdown strings.

---

## 2. Bio refresh

**Trigger**: Twenty Workflow fires when `callLog.summary` becomes non-null
(or use n8n cron / direct webhook from inbound-SMS classifier).

**Goal**: regenerate `Person.aiBiography` from latest call/SMS context.

### Twenty Workflow side

```
Name:    Refresh AI biography on new call summary
Trigger: Record updated
  Object:  Call log
  Filter:  summary changed (any → non-null)
Step 1:  Send HTTP request
  Method:  POST
  URL:     https://<your-n8n-host>/webhook/refresh-bio
  Headers: Content-Type: application/json
  Body:    { "callLogId": "{{record.id}}", "personId": "{{record.person.id}}" }
```

### n8n side

```
Webhook (POST /refresh-bio)
  └─ Function: read { callLogId, personId } + debounce check
  └─ HTTP: GET Person + current aiBiography (Twenty GraphQL)
  └─ HTTP: GET callLog summary + aiTranscript (Twenty GraphQL)
  └─ HTTP: GET last 3 calls + 3 SMS for context (Twenty GraphQL)
  └─ LLM: regenerate biography (markdown output)
  └─ Function: convert markdown → { markdown, blocknote }   ← PASTE FROM SNIPPETS.md
  └─ HTTP: PATCH updateOnePerson { aiBiography: { markdown, blocknote } }
```

### Node 1 — Webhook trigger

```
Method:        POST
Path:          /refresh-bio
Response Mode: Immediately (return 200 fast, processing happens async)
```

### Node 2 — Function: input + debounce

```js
const { callLogId, personId } = $input.first().json;
if (!personId) return [{ json: { skipped: 'no_person' } }];
return [{ json: { callLogId, personId } }];
```

### Node 3 — HTTP: GET Person + current bio

```graphql
query GetPerson($id: ID!) {
  person(filter: { id: { eq: $id } }) {
    id
    name { firstName lastName }
    aiBiography
    updatedAt
  }
}
```

Variables: `{ "id": "{{ $json.personId }}" }`.

### Node 4 — Debounce: bail if updated <60s ago

```js
const person = $input.first().json.data.person;
if (person.updatedAt && Date.now() - new Date(person.updatedAt).getTime() < 60_000) {
  return [{ json: { skipped: 'too_recent' } }];
}
return [{ json: { person, callLogId: $('Function: input + debounce').first().json.callLogId } }];
```

(Wire a Switch node after this to short-circuit `skipped` branches.)

### Node 5 — HTTP: GET callLog summary + transcript

Same shape as Node 3, query callLog by id, select `summary { markdown }`,
`aiTranscript { markdown }`, `aiSummary` etc.

### Node 6 — HTTP: GET context (last 3 calls, last 3 SMS)

Filter `callLog` and `smsLog` by `personId`, order by `createdAt DESC`,
limit 3 each.

### Node 7 — AI Agent: regenerate biography

```
System prompt:
  You maintain a condensed Polish-language biography of CRM contacts. Given:
    - Existing biography (may be empty)
    - Latest call summary + transcript
    - Last 3 calls + last 3 SMS for context

  Produce an updated biography in Markdown:
    - **Bold** the contact's full name as the first line
    - 2-4 short sections (## headings) for: profile, current status, preferences, history
    - Bullet points for facts; preserve specific dates / amounts / names verbatim
    - No emoji, no fluff, ≤500 words

User prompt:
  Existing bio:
  {{ $json.person.aiBiography?.markdown ?? '(empty)' }}

  Latest call:
  Summary: {{ $('HTTP: callLog').first().json.data.callLog.summary?.markdown }}
  Transcript: {{ $('HTTP: callLog').first().json.data.callLog.aiTranscript?.markdown }}

  Recent context:
  {{ JSON.stringify($('HTTP: context').first().json.data, null, 2) }}
```

Output: markdown string.

### Node 8 — Function: markdown → BlockNote

Paste the `markdownToBlocknote` helper from
[`docs/SNIPPETS.md`](../../docs/SNIPPETS.md). At the bottom:

```js
const markdown = $input.first().json.output;
const richText = markdownToBlocknote(markdown);
return [{
  json: {
    personId: $('Function: input + debounce').first().json.personId,
    aiBiography: richText,
  },
}];
```

### Node 9 — HTTP: PATCH updateOnePerson

```
Method:                 POST (Twenty GraphQL endpoint)
URL:                    {{ $env.TWENTY_API_URL }}/graphql
Authentication:         Header Auth — Bearer
Body type:              JSON
Body:                   {{ $json | JSON-stringified mutation as below }}
```

```graphql
mutation UpdateBio($id: ID!, $bio: RichTextV2Input!) {
  updateOnePerson(id: $id, data: { aiBiography: $bio }) { id }
}
```

Variables: `{ "id": "{{ $json.personId }}", "bio": {{ $json.aiBiography }} }`.

### Failure handling — marker pattern

If the LLM call errors, append a marker to the existing bio rather than
losing it:

```js
const oldMd = $('HTTP: GET Person').first().json.data.person.aiBiography?.markdown ?? '';
const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
const newMd = `${oldMd}\n\n---\n_⚠ Last refresh failed at ${ts} — bio may be stale._`;
const richText = markdownToBlocknote(newMd);
// then PATCH as in Node 9
```

The next successful refresh overwrites the whole field, clearing the
marker automatically.

---

## 3. Inbound SMS classifier

**Trigger**: this App's `smsLog.created` DB event with `direction='IN'`,
fanned out to n8n via a Twenty Workflow HTTP step (or, if you keep classification fully in n8n, directly from the inbound webhook).

**Goal**: classify intent → route meaningful messages to the bio-refresh
sub-flow; log only for noise.

### Flow

```
Webhook (POST /inbound-sms)
  └─ Function: read { smsLogId, personId, body }
  └─ AI Agent: intent classifier (single-label output)
  └─ Switch on category:
       interest_positive / interest_neutral / email_capture →
         POST /webhook/refresh-bio { callLogId: null, personId }
       opt_out → PATCH Person { doNotSms: true } + log
       unclear / spam → log only
  └─ Catch: PATCH smsLog with classifier label (audit trail)
```

### Node 1 — Webhook trigger

```
Method:        POST
Path:          /inbound-sms
```

### Node 2 — AI Agent: classifier

```
System prompt:
  Classify the inbound SMS into ONE of these categories. Output the bare
  label (no JSON, no quotes):
    interest_positive  // "tak", "kiedy mogę umówić", "interesuje mnie"
    interest_neutral   // "może", "powiedz więcej", neutral question
    email_capture      // contains an email address
    opt_out            // "STOP", "nie wysyłajcie", "rezygnuję"
    unclear            // off-topic, autoresponder, gibberish
    spam               // marketing from competitors, bots

User prompt:
  {{ $json.body }}
```

### Node 3 — Switch on label

5 outputs, one per category.

### Node 4a (positive/neutral/email) — HTTP: trigger bio-refresh

POST to `/webhook/refresh-bio` from §2 above with
`{ "callLogId": null, "personId": $json.personId }`.

### Node 4b (opt_out) — HTTP: PATCH Person doNotSms=true

```graphql
mutation OptOut($id: ID!) {
  updateOnePerson(id: $id, data: {
    doNotSms: true
    doNotSmsAt: "{{ $now.toISO() }}"
    doNotSmsReason: "Inbound SMS classified as opt_out"
  }) { id }
}
```

### Node 5 — HTTP: PATCH smsLog with classifier label

```graphql
mutation TagSms($id: ID!, $cat: String!) {
  updateOneSmsLog(id: $id, data: { category: $cat }) { id }
}
```

Provides an audit trail without depending on App-side enums.

---

## Troubleshooting

### "Authorization failed" from Twenty endpoints

- Token expired or never created. Recreate in `Settings → Applications →
  Zadarma → Access tokens`.
- Token is bound to one workspace; using it against another workspace's
  Twenty URL fails silently.

### `/zadarma/call-enrichment` returns `matched: false`

- Zadarma `NOTIFY_END` webhook hasn't landed yet — n8n retry policy
  (3 × 5/15/30s backoff) usually resolves this.
- `requireExtensions: true` with `AI_EXTENSIONS` not configured → no
  candidate callLogs match. Set `AI_EXTENSIONS=103,105` (your AI
  extensions) in App settings.

### `aiBiography` shows raw `**` after refresh

- The PATCH did not include `blocknote`. Verify Node 8 ran the
  `markdownToBlocknote` helper and Node 9 sent both fields.

### Bio refresh fires too often

- Add a longer debounce in Node 4 (e.g. 5 minutes). Or filter on
  `aiInterestLevel >= 3` to only refresh on meaningful calls.

### LLM costs spiking

- Throttle the bio-refresh sub-flow with n8n's rate-limit node (1 call /
  10s) — covers the case where 50 calls land in a minute and try to
  refresh 50 bios at once.
