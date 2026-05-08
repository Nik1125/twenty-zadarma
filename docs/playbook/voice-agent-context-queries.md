---
purpose: GraphQL query patterns an AI voice agent (Retell / Vapi / similar) uses to fetch Person + recent activity context before placing or answering a call.
applies_when: An external AI agent needs to load a Person dossier (history, notes, current Opportunity, opt-out flags) seconds before connecting a call so it can speak naturally about prior interactions.
related: [analytics-tags-on-send.md, optout-via-n8n-llm.md, ../AI_ENRICHMENT.md]
---

# Voice agent context queries

## Problem

When an AI voice agent connects to a customer, it has milliseconds to load context: who is this person, what did we last talk about, are they opted-out of anything, what Opportunity are they in, what was the outcome of our previous call. The naïve solution — query each piece separately — burns round-trips and leaves the agent blank for the first few seconds. The other naïve solution — denormalise everything onto the Person record — pollutes the schema with derived fields that drift.

## Solution

Use a **single batched GraphQL query** against Twenty's Core API that fetches Person + last N callLogs + last N smsLogs + most recent open Opportunity + recent Notes via `noteTargets` polymorphic links. Read the result as one structured payload and feed selected fields into the agent's system prompt. The Person record stays clean; the query layer composes whatever the agent needs.

## Steps

### Query template (paste into n8n GraphQL node or Retell tool function)

```graphql
query AgentContext($personId: UUID!) {
  person(filter: { id: { eq: $personId } }) {
    id
    name { firstName lastName }
    phones { primaryPhoneNumber primaryPhoneCallingCode additionalPhones }
    emails { primaryEmail }
    doNotCall
    doNotSms
    doNotSmsReason
    activeCallStatus
    activeCallCooldownUntil
    lastContactedAt
    callLogs(first: 5, orderBy: { callStart: DescNullsFirst }) {
      edges {
        node {
          id
          direction
          callStart
          duration
          disposition
          callerType
          aiVendor
          aiAgentName
          aiSentiment
          aiSuccessful
          summary
        }
      }
    }
    smsLogs(first: 5, orderBy: { sentAt: DescNullsFirst }) {
      edges {
        node {
          id
          direction
          body
          sentAt
          source
          category
          templateName
        }
      }
    }
    opportunities(first: 1, orderBy: { createdAt: DescNullsFirst }, filter: { stage: { in: ["NEW", "QUALIFIED", "PROPOSAL", "NEGOTIATION"] } }) {
      edges {
        node {
          id
          name
          stage
          amount { amountMicros currencyCode }
          createdAt
        }
      }
    }
    noteTargets(first: 3, orderBy: { createdAt: DescNullsFirst }) {
      edges {
        node {
          note {
            id
            title
            body
            createdAt
          }
        }
      }
    }
  }
}
```

### Map the result to the agent system prompt

The agent prompt should consume the structured fields, not dump the raw JSON. Example mapping:

```
Customer: {firstName} {lastName}, phone {phones.primaryPhoneCallingCode}{phones.primaryPhoneNumber}.
Opt-out flags: {doNotCall ? "do not call" : "calls allowed"}, {doNotSms ? "do not SMS" : "SMS allowed"}.
Active opportunity: {opportunities[0].name} (stage {opportunities[0].stage}).
Last contact: {lastContactedAt}, {callLogs[0].direction} call, {callLogs[0].disposition}, {callLogs[0].callerType} caller.
Recent calls (newest first):
  - {callLogs[0].callStart}: {callLogs[0].direction} {callLogs[0].disposition}, summary: {callLogs[0].summary}
  - {callLogs[1].callStart}: ...
Last SMS exchange:
  - {smsLogs[0].sentAt}: {smsLogs[0].direction} "{smsLogs[0].body}"
Latest notes (most recent first):
  - {noteTargets[0].note.createdAt}: {noteTargets[0].note.title} — {noteTargets[0].note.body}
```

### Pre-call gate — refuse to dial if blocked

Before connecting, the agent's preflight check:

1. If `doNotCall = true` → abort, log refusal in `smsLog` or in the agent's own audit channel.
2. If `activeCallStatus = CALLING` → abort, the Person is already on a line (someone else's dialer beat you).
3. If `activeCallCooldownUntil > now` → defer, the cooldown protects against back-to-back attempts.

The Zadarma App publishes the active-call lock fields; consumers (the agent here) read and respect. See `docs/ACTIVE_CALL_LOCK.md` for the full contract.

### Post-call enrichment

After the call ends, the agent (or its n8n adapter) PATCHes the resulting `callLog` via the vendor-agnostic enrichment endpoint `POST /s/zadarma/call-enrichment`. Sentiment, success, transcript, summary, recording URL, AI agent name all land on the row. This step is independent of the pre-call query — see `docs/AI_ENRICHMENT.md` for the request shape.

### Ongoing — note creation via polymorphic noteTargets

When the call yields persistent context worth keeping (transcript summary, follow-up commitment, biographical detail), the agent / adapter creates a Note via the Core API and attaches it to **multiple targets simultaneously** — the Person (always), the active Opportunity (if relevant), and the callLog (always, for drill-down):

```graphql
mutation {
  createNote(data: { title: "Call summary 2026-05-09", body: { markdown: "..." } }) {
    id
  }
}
```

Then create three `noteTarget` rows pointing at the new Note's `id` and the three parent IDs. Twenty's UI surfaces the same Note under all three parents — `Person.notes`, `Opportunity.notes`, and the callLog's drill-down. No "either/or" choice between Person-attached and Opportunity-attached.

## Why this approach

**Considered: denormalising the agent payload onto Person (`Person.lastCallSummary`, `Person.lastSentiment`, `Person.recentCallCount`).** Rejected because:

- The "agent context" set is one of many possible read patterns — managers want a different slice, dashboards want a third, the chat panel wants a fourth. Picking one set to denormalise privileges that consumer's needs over everyone else's.
- Denormalised fields drift from source data. A summary that lives on Person will be stale within hours of the call that produced it.
- Twenty's GraphQL is fast enough — a single batched query for Person + last 5 calls + last 5 SMS + 3 notes returns in tens of milliseconds against a workspace of any realistic size. The supposed "round-trip cost" is solved by batching, not by denormalisation.

**Considered: a dedicated `/zadarma/agent-context` REST endpoint inside the App that returns the curated payload.** Rejected because:

- The query is pure read against Twenty's existing Core API. Wrapping it in an App endpoint adds zero value (no signing, no business logic, no opt-out enforcement that matters before the dial).
- Different agent vendors (Retell, Vapi, ElevenLabs, n8n LLM nodes) have different prompt-construction needs. A fixed REST shape would force every consumer to either use our shape or build adapter code anyway.
- GraphQL's selection-set model already lets each consumer pick exactly the fields they need. That's the right composition layer.

**Considered: pushing context to the agent via a webhook on call placement.** Rejected because the agent's own runtime is the right place to query — it knows its own latency budget and can fan out queries in parallel with other prep work (e.g. loading the agent's own prompt template, wiring transcription).

The pre-call query happens **inside the agent's own runtime** (Retell tool function, Vapi assistant pre-call hook, n8n step before the dial) — not inside the Zadarma App. The App's job is to expose clean schema and the active-call lock fields. The agent composes the rest.
