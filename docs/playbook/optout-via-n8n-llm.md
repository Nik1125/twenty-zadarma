---
purpose: Classify inbound SMS intent with an LLM in n8n and translate it into structured updates on Person — opt-out flags, email corrections, complaints, etc. — without parsing SMS bodies inside the App.
applies_when: Customers reply to outbound SMS in free-form language ("nie pisz", "stop", "не пишите", "удалите мой номер", "поправьте мою почту"); the workspace needs a single classifier that drives multiple downstream actions.
related: [voice-agent-context-queries.md, ../../README.md#legal--data-protection]
---

# Inbound SMS opt-out via n8n + LLM

## Problem

Customers send inbound SMS in many languages, idioms, and emotional registers. Some are opt-outs ("stop", "REZYGNUJ", "не хочу больше получать"), some are channel-specific opt-outs ("nie pisz, ale dzwonić można"), some are corrections ("mój nowy email to ..."), some are complaints, some are info requests. A regex/keyword approach inside the Zadarma App would:

1. Get the long tail of phrasings wrong (false negatives → keep SMSing someone who explicitly asked to stop, GDPR risk).
2. Couple the App's release cycle to language-specific phrase lists.
3. Lose the ability to extract structured data (e.g. the new email address inside a "поправьте мою почту на ..." reply).

## Solution

Run a **single LLM intent classifier** on every inbound `smsLog` row, using n8n as the orchestrator. The classifier returns a structured JSON ({ intent, extracted_data, confidence }), and a Switch node routes to one of N action paths — most commonly setting `Person.doNotSms = true` with a quote of the originating message in `Person.doNotSmsReason`. The Zadarma App stays neutral: it stores the flags, refuses outbound sends when set, but never tries to interpret SMS content itself.

## Steps

### 1. n8n trigger — listen for inbound smsLog

Twenty's webhook subscribes to `smsLog.created`. Filter to `direction = IN`. Forwards `{ id, personId, body, clientNumber, sentAt }` to n8n.

### 2. Load Person context

GraphQL query in n8n:

```graphql
query($personId: UUID!) {
  person(filter: { id: { eq: $personId } }) {
    id
    name { firstName lastName }
    doNotCall
    doNotSms
    emails { primaryEmail }
  }
}
```

### 3. LLM classifier node

Prompt template (Polish-flavoured example; adjust per workspace language mix):

```
You are an intent classifier for inbound SMS replies to a sales/service team.

The customer's previous state:
- Name: {{firstName}} {{lastName}}
- Currently opted-out of SMS: {{doNotSms}}
- Currently opted-out of calls: {{doNotCall}}
- Email on file: {{primaryEmail}}

The inbound SMS body:
{{body}}

Classify the intent into exactly ONE of:
- opt_out_sms        — customer asks to stop SMS specifically (calls may still be OK)
- opt_out_call       — customer asks to stop calls specifically (SMS may still be OK)
- opt_out_all        — customer asks to stop all communication
- email_update       — customer provides a new email address; extract it
- complaint          — customer expresses dissatisfaction without asking to opt out
- info_request       — customer asks a question
- confirmation       — customer confirms appointment / payment / similar
- other              — none of the above; no action needed

Return JSON ONLY:
{
  "intent": "<one of the above>",
  "confidence": 0.0..1.0,
  "extracted": { "email": "..."  // only for email_update },
  "quote": "<verbatim quote from the SMS body, max 100 chars, useful as Person.doNotSmsReason>"
}
```

Use a model with structured-output support (Claude with `tool_use`, GPT with JSON mode, or similar). Set temperature to 0 for stable classification.

### 4. Switch node — route on intent

| Intent | Action |
|---|---|
| `opt_out_sms` | GraphQL mutation: `updatePerson(id: <personId>, data: { doNotSms: true, doNotSmsAt: <now>, doNotSmsReason: "<quote>" })` |
| `opt_out_call` | GraphQL mutation: `updatePerson(id: <personId>, data: { doNotCall: true })` |
| `opt_out_all` | Both mutations above. |
| `email_update` | GraphQL mutation: `updatePerson(id: <personId>, data: { emails: { primaryEmail: "<extracted.email>" } })`. Optional: append the old email to `additionalEmails`. |
| `complaint` | Twenty Workflow create-Task action assigning the case to a senior operator; tag the Task with `priority: HIGH`. |
| `info_request` | Trigger a reply template via `POST /s/zadarma/send-template`-style flow (see `analytics-tags-on-send.md`). |
| `confirmation` | Update the relevant Opportunity or Task to status `CONFIRMED`. |
| `other` | No-op. Optionally log a metric for prompt tuning. |

### 5. Confirmation SMS (only for opt-outs)

After setting `doNotSms = true`, send a single confirmation SMS via `POST /s/zadarma/send-sms` with body in the customer's language (e.g. "Twoja prośba została zarejestrowana. Już nie będziemy pisać.") and tags `category: TRANSACTIONAL`, `source: N8N`, `templateName: stop_confirm_pl`. Per Polish Art. 172 PT, sending one confirmation reply is generally compliant; sending more would re-violate the opt-out the customer just exercised — **don't loop**.

The send-sms guard refuses outbound sends to opted-out Persons, but the confirmation SMS is the one allowed exception. Workspace operators must decide: either (a) send the confirmation **before** PATCHing the flag (so the guard does not fire), or (b) accept that the very-first confirmation will fail and the customer simply sees no reply. Option (a) is the cleaner pattern.

## Why this approach

**Considered: regex / keyword matching inside the Zadarma App.** Rejected because:

- Polish, Russian, English, German, French, Spanish, Ukrainian, etc. — every language has tens of phrasings for "stop". A regex bank that covers them all would be giant and brittle. False negatives mean the App keeps SMSing someone who asked to stop — direct GDPR / Polish Art. 172 PT exposure.
- Extracted data (new email, complaint context) is impossible with regex.
- LLM iteration is fast (edit prompt in n8n, save, done). App release cycle is slow (`yarn twenty deploy && install`).
- Workspaces differ on which intents map to which actions. The intent → action mapping is workspace-specific operating policy; baking it into the App would force a re-release every time policy shifts.

**Considered: classifier endpoint inside the Zadarma App that wraps the LLM call.** Rejected because:

- Workspaces use different LLM providers (OpenAI, Claude, self-hosted Ollama, vendor-specific) for cost / privacy / latency reasons. The App can't assume any of them.
- The classifier prompt is workspace-specific (language mix, business vocabulary). Hardcoding one prompt would force everyone into one operator's choice.
- The LLM call costs tokens. Putting the spend inside the App would muddle the workspace's own budget tracking.

**Considered: requiring customers to type a specific keyword.** Rejected because:

- Customers don't read instructions in marketing SMS footers. They write what feels natural.
- Forcing them to use specific keywords loses the long tail of legitimate opt-out signals — that's the customer experience equivalent of a "don't try harder than you have to" approach to GDPR compliance, which courts and regulators look at unfavourably.

The Zadarma App's role is to provide the **enforcement primitive** (`doNotSms` flag + send-side guard). The intelligence layer that decides when to set it lives where intelligence is cheap to iterate: n8n with an LLM. This split keeps the App boring and the policy layer flexible.

For the legal context — which jurisdiction recognises which opt-out mechanism, who is the data controller, when a fresh ad-click constitutes new consent — see the `## Legal & data protection` section in the public README and the developer-internal note at `my_files/GDPR-developer-context.md` (gitignored, manager-readable).
