---
purpose: Build a manager inbox for unmatched / unhandled calls and SMS using Twenty saved views, with no custom App-side UI.
applies_when: A manager needs a single screen to triage today's inbound traffic — unmatched calls (no Person link), missed inbound, opt-out replies, etc.
related: [missed-call-to-task-workflow.md, ../IMPORT.md]
---

# Inbox via saved views

## Problem

Managers want a single "inbox" view of recent telephony activity that needs attention: missed inbound calls, unmatched SMS, opt-out replies, calls awaiting AI enrichment, etc. The naïve solution is to build a custom front-component inside the App that aggregates these. That solution drifts out of sync with Twenty's own list-view features (filtering, sorting, saved-as-favourite, share-with-teammates) and forces every operator to learn one more UI surface.

## Solution

Use Twenty's native **saved views** on `callLog` / `smsLog` with predicate filters that capture the inbox criteria. Pin the saved view to the left sidebar so the manager opens it with one click. The app exposes the right schema fields (`direction`, `disposition`, `personId`, `category`, `source`, `doNotSms`, etc.); Twenty's standard filtering does the rest.

## Steps

### Inbox 1 — Unmatched inbound (call or SMS without a Person)

1. Open the **All calls** view in the left sidebar.
2. Click **Filter** → add a filter: `Person → Is empty`.
3. Click **Filter** → add a filter: `Direction → IN`.
4. Click **Filter** → add a filter: `Created at → After → 24 hours ago` (or whatever window the team works in).
5. Click the view name → **Save as new view** → name it "Unmatched inbound calls".
6. Right-click the saved view → **Pin to sidebar**.
7. Repeat the same flow on **All SMS**.

### Inbox 2 — Missed inbound calls awaiting callback

1. Open **All calls**.
2. Filters: `Direction = IN`, `Disposition = NO_ANSWER` (or `BUSY`), `Created at After 24 hours ago`.
3. Save as "Missed inbound — needs callback". Pin.

### Inbox 3 — Opt-out replies that need legal/operator review

1. Open **All people**.
2. Filter: `Do not SMS = true`.
3. Sort by `Do not SMS at → Newest first`.
4. Save as "Opt-outs — recent". Pin.

The Person card opens the chat panel which already shows the `doNotSmsReason` quote — operator sees the originating message in context.

### Inbox 4 — AI calls awaiting enrichment

After v0.10.0, AI calls land in `callLog` and the n8n / vendor adapter populates `aiVendor` / `aiAgentName` / etc. via `/zadarma/call-enrichment`. To spot calls that arrived from an AI extension but have not yet been enriched (vendor adapter delay or failure):

1. Open **All calls**.
2. Filters: `Caller type = AI`, `AI vendor → Is empty`.
3. Save as "AI calls — enrichment pending".

### Inbox 5 — High-volume operator dashboard (manager workload review)

1. Open **All SMS**.
2. Filters: `Source = N8N` (to exclude manual chat-panel sends), `Created at After 7 days ago`.
3. Group by `Template name`. (Twenty's group_by surfaces the count per template automatically.)

## Why this approach

**Considered: a custom "Inbox" front-component inside the Zadarma App.** Rejected because:

- Twenty saved views already handle pin-to-sidebar, share-with-teammates, default sort, mobile rendering, theme adaptation, and keyboard shortcuts. Re-implementing those inside an App component would duplicate Twenty's surface area badly.
- Saved-view definitions are stored in the workspace, so each manager / role can have their own without an App release.
- App-defined filter logic would couple the App to one workspace's specific operating model. Saved views are workspace-local.
- Filter expressions in saved views are visible and editable to operators; a custom component would hide its filter logic in source code.

**Considered: an `applicationVariable` JSON listing "default inbox queries" auto-loaded on App install.** Rejected because workspaces have very different operating models — the second project's callback-cycle workflow has different inbox needs than a one-shot lead-conversion workflow. Letting each workspace build its own saved views is more honest than shipping a list of "official" ones.

The right primitive for App-side inbox features is **schema fields** (`category`, `source`, `disposition`, `doNotSms` etc.) — those exist regardless of which inbox a workspace builds. The composition layer stays in Twenty.
