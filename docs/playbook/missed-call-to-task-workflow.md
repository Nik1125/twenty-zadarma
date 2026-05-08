---
purpose: Auto-create a Task on every missed inbound call so the operator never has to remember to call back manually.
applies_when: An inbound call lands with disposition NO_ANSWER, BUSY, or CALL_FAILED and the team wants a structured callback queue rather than scrolling the call log.
related: [inbox-via-saved-views.md, ../ACTIVE_CALL_LOCK.md]
---

# Missed call → Task auto-create (Twenty Workflow)

## Problem

Inbound calls go unanswered — operator was busy, was on another line, or the customer hung up before pickup. Today the only signal is a `callLog` row with `disposition: NO_ANSWER` (or `BUSY` / `CALL_FAILED`); spotting it requires the manager to scan the call log. By the time anyone notices, the customer has likely tried a competitor.

## Solution

Use a **Twenty Workflow** triggered on `callLog.created` with a filter on disposition. The workflow's action creates a Task linked to the matched Person, assigned to a designated operator (or auto-routed by load), with a due date in the next hour. No App-side automation required — Twenty's native Workflow engine handles trigger, filter, action, and retries.

## Steps

### One-time setup

1. Open **Settings → Workflows → New workflow**.
2. Name it "Missed call → Task".
3. Trigger:
   - Type: **Object event**
   - Object: **Call log**
   - Event: **Record created**
4. Add a Filter step:
   - Field: `direction`, Operator: equals, Value: `IN`.
   - Field: `disposition`, Operator: equals one of, Values: `NO_ANSWER`, `BUSY`, `CALL_FAILED`.
5. Add an Action step:
   - Type: **Create record**
   - Object: **Task**
   - Fields:
     - `title`: `Callback: {{trigger.callLog.clientNumber}}`
     - `body`: `Missed inbound at {{trigger.callLog.callStart}} — {{trigger.callLog.disposition}}`
     - `assigneeId`: ID of the operator who handles callbacks (or use Twenty's round-robin extension if installed)
     - `dueAt`: now + 1 hour (use a Twenty expression node)
     - `targetPersonId`: `{{trigger.callLog.personId}}` (only set when populated; the Workflow's "skip empty" toggle handles unmatched calls — see Variant below)
6. Save and **Activate** the workflow.

### Variants

**Variant — Unmatched calls (no Person link).** Add a branch step before the action: if `personId` is empty, route to a different action that creates a Task with `title: "Callback: <unknown caller>"` and assigns to a "triage" operator instead. The triage operator's first job is to identify the caller and link the Person manually; the Twenty `link-orphans-on-person-(created|updated)` DB-event-trigger will retroactively bind the callLog when a matching Person is created or updated.

**Variant — Skip if recent outbound exists.** Add a Filter step: only create a Task if `Person.lastContactedAt` is more than 1 hour ago. Prevents Task spam during active sales cycles where the operator is already in conversation.

**Variant — Use the active-call lock.** Skip Task creation when `Person.activeCallStatus = CALLING` (someone is already on the line) — the missed inbound is likely a parallel attempt by the same Person. See `docs/ACTIVE_CALL_LOCK.md` for the consumer contract.

## Why this approach

**Considered: App-side webhook handler that creates a Task directly.** Rejected because:

- The trigger logic ("on disposition NO_ANSWER for inbound calls") is a workflow concern, not a transport concern. The Zadarma App's job is to write `callLog` rows faithfully; what to do with them is workspace-specific.
- Twenty's Workflow engine has retry, conditional branching, and audit logging built-in. Re-implementing those in a logic-function would duplicate Twenty's surface badly.
- Workspaces differ on assignment policy (round-robin / load-based / single owner). Hardcoding any policy in the App would force a re-release whenever the workspace rule changes.

**Considered: a dedicated `/zadarma/missed-call-task` endpoint that callers explicitly fire.** Rejected because the trigger is an internal database event (`callLog.created`), not an external integration boundary. Forcing n8n to listen for the event and call back into Twenty is one round-trip more than letting Twenty's own Workflow engine handle it.

**Considered: surfacing missed calls via a saved view ("Missed inbound — needs callback") instead of a Task.** Both patterns can coexist. The saved view (see `inbox-via-saved-views.md`) is the read-side; the Task workflow is the write-side that puts the missed call into the operator's normal Task queue alongside the rest of their work, complete with due date and assignee tracking. Use the saved view for triage; use the Task for accountability.
