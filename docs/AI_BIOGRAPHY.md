# AI biography (`Person.aiBiography`)

A condensed, AI-maintained biography of each contact. Populated and refreshed
by external automation (Twenty Workflow + n8n, or n8n directly). The App owns
**storage only** — refresh logic, LLM prompts, and trigger thresholds are
workspace-specific and live outside the App's code.

## Why a single field instead of a Note

Earlier versions of this integration kept the biography as a Note linked to
Person via `noteTargets`. That pattern was retired in v0.19.0 for transcripts
and applies here too: a typed RICH_TEXT field on Person itself is

- **easier to query** — no join through `noteTargets`,
- **easier to read** — visible directly on the Person record-show page,
- **easier to backfill** — one `updateOnePerson` mutation instead of
  `createNote` + `createNoteTarget`.

If you have legacy biographies stored as Notes today, run the backfill
script from §3 below to migrate them once.

## Trigger flows

Pick the trigger model that fits each event source.

### 1. Calls — Twenty Workflow

The richest moment of context for a call is when n8n's call-enrichment
adapter has just finished writing `aiTranscript` + `summary` (the AI
summary). That is the trigger.

#### Twenty Workflow configuration

```
Name:    Refresh AI biography on new call summary
Trigger: Record updated
  Object:    Call log
  Filter:    summary changed (any → non-null)
Step 1:  Send HTTP request
  Method:    POST
  URL:       https://<your-n8n-host>/webhook/refresh-bio
  Headers:   Content-Type: application/json
  Body:      { "callLogId": "{{record.id}}", "personId": "{{record.person.id}}" }
```

If a callLog has no linked Person (orphan), `record.person.id` is empty —
the Workflow short-circuits server-side, no webhook fires.

#### n8n flow on the receiving side

```
Webhook (POST /refresh-bio)
  └─ Function: read incoming { callLogId, personId }
  └─ HTTP: GET Twenty - Person + Person.aiBiography (current)
  └─ HTTP: GET Twenty - the specific callLog (for aiTranscript + summary)
  └─ (optional) HTTP: GET Twenty - last 2-3 calls + last 3 SMS for richer context
  └─ LLM (your prompt): "Update biography with new context" → markdown output
  └─ Function: convert markdown → { markdown, blocknote } via the helper in
                docs/SNIPPETS.md (mandatory — markdown alone renders raw
                `**` until the operator manually edits the field).
  └─ HTTP: PATCH Twenty - updateOnePerson { aiBiography: { markdown, blocknote } }
  └─ Catch error branch:
       └─ markdown = <oldBio> + "\n\n---\n_⚠ Last refresh failed at <ts>_"
       └─ Function: convert markdown → { markdown, blocknote }
       └─ HTTP: PATCH updateOnePerson { aiBiography: { markdown, blocknote } }
```

> **RICH_TEXT v2 contract** — both `markdown` AND `blocknote` (JSON-stringified
> BlockNote document) must be sent on every write. The BlockNote editor
> renders from the `blocknote` field on read; markdown alone is treated as
> raw text and shows literal `**` / `##` / `-` characters until a human
> edits the field. See [docs/SNIPPETS.md](./SNIPPETS.md) for a copy-pasteable
> n8n Function node.

Debounce inside the n8n flow:

```js
// at the top of the function node, after fetching the Person:
const lastUpdated = person.updatedAt; // or aiBiography.updatedAt if Twenty exposes it
if (lastUpdated && Date.now() - new Date(lastUpdated).getTime() < 60_000) {
  return [{ json: { skipped: 'too_recent' } }]; // bail without LLM call
}
```

### 2. SMS — n8n directly

Your existing inbound-SMS classifier flow in n8n already determines whether
the message is meaningful (`interest_positive`, `interest_neutral`,
`email_capture`, etc.) versus noise (`unclear`, `opt_out`).

At the end of the meaningful branch, call your bio-refresh sub-workflow
with `{ personId }`. **No Twenty Workflow is involved.** This avoids
Twenty firing on every smsLog row.

```
Inbound SMS webhook
  └─ Classifier (your existing LLM)
  └─ Switch on category:
       interest_positive / interest_neutral / email_capture →
         └─ HTTP: POST localhost / sub-workflow refresh-bio { personId }
       opt_out / unclear → log only, skip bio refresh
```

### 3. Legacy backfill — n8n script

For Persons that pre-date the App's `aiBiography` field (or had bios stored
as Notes), run a one-off n8n script:

```js
// Pseudo-code for the n8n Code node
const PAGE_SIZE = 50;
let after = null;

while (true) {
  const res = await twentyGraphQL(`
    query($after: String) {
      people(
        first: ${PAGE_SIZE}
        after: $after
        filter: {
          aiBiography: { primaryLinkUrl: { is: NULL } }
          phones: { primaryPhoneNumber: { is: NOT_NULL } }
        }
        orderBy: [{ createdAt: AscNullsLast }]
      ) {
        edges { node { id name { firstName lastName } phones { primaryPhoneNumber } } }
        pageInfo { hasNextPage endCursor }
      }
    }
  `, { after });

  for (const { node: person } of res.people.edges) {
    // Read history, run LLM, write aiBiography back
    await refreshBio(person.id);
    await sleep(1500); // throttle for LLM provider rate limits
  }

  if (!res.people.pageInfo.hasNextPage) break;
  after = res.people.pageInfo.endCursor;
}
```

Run from a manual n8n Execute Node when you're ready. Skip the Twenty
Workflow path — backfill is a deliberate one-off, not an event-driven
trigger.

## Failure handling — the marker pattern

When the LLM call fails (timeout, quota, model error), the n8n handler
should NOT lose the existing biography. Instead, append a small footer
to the current markdown:

```markdown
**Anna Kowalska** — kosmetolog, Warszawa, 5+ lat doświadczenia ...
[full existing bio remains]

---
_⚠ Last refresh failed at 2026-05-10 14:23 — bio may be stale._
```

Three properties:

1. The operator still reads the bio normally (the warning is at the end).
2. The operator sees at-a-glance whether the latest refresh succeeded.
3. The next successful refresh **overwrites the whole field**, so the
   marker self-clears without any cleanup logic.

For higher-fidelity tracking (dashboards counting stale bios, SLA alerts,
retry queues), add a `bioStatus` SELECT field in a future release. The
v1 design intentionally avoids that field — the marker covers the 99%
operator-visibility case without schema cost.

## What the App provides

- **`Person.aiBiography`** — RICH_TEXT, nullable, custom field on
  standard Person. The single source of truth. UID:
  `459a45a0-c02a-48be-8e8d-371e8a4de4b4`.
- **Nothing else.** No applicationVariables, no logic-functions, no
  Settings UI. Trigger configuration lives entirely in Twenty Workflow
  + n8n / external automation.

## Out of scope (intentionally)

- **App-side LLM calls** — the App never invokes an LLM. Provider
  selection, prompt versioning, model swaps live in n8n / Twenty native
  AI workflow nodes.
- **Status tracking** (`bioStatus` enum, `bioUpdatedAt` field) —
  deferred until a real use-case demands it (see "marker pattern" above).
- **Auto-refresh on every event** without filtering — that's a workspace
  policy decision; configure thresholds in your Twenty Workflow trigger
  filter or in your n8n classifier branch.
- **Backfill button in Settings UI** — n8n script is more flexible
  (date filters, type filters) and avoids surface area in the App.
