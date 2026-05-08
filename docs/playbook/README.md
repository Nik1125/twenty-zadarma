# Zadarma App Playbook

Atomic recipes for managers, AI agents, and developers integrating with this app. Each recipe is a self-contained markdown file that solves one well-defined problem with a documented pattern.

## How to use

- **For managers**: scan the index below, find the use-case that matches your goal, follow the steps section.
- **For AI agents (Retell / Vapi / n8n LLM nodes)**: recipes are designed to be retrieved by topic. Frontmatter `purpose` and `applies_when` are the search keys. Each recipe's `Steps` section is enough to act on; `Why this approach` documents alternatives the project considered and rejected.
- **For developers**: when you implement a new pattern, add a recipe here so the next person doesn't reinvent the same decision.

## Recipe structure

Every recipe in this directory follows the same shape:

```yaml
---
purpose: One-line description of what this solves
applies_when: Concrete trigger / scenario in which to reach for this recipe
related: [other-recipe.md, skills/some-skill, docs/SOME.md]
---

# Title

## Problem
The pain point.

## Solution
The pattern in 2-3 sentences.

## Steps
1. Concrete action
2. Concrete action
3. ...

## Why this approach
Alternatives considered and rejected, with reasoning. Prevents future contributors from re-proposing patterns that were already evaluated.
```

The `Why this approach` section is non-negotiable — it captures load-bearing context that vanishes if not written down.

## Index

### Manager workflows

- [inbox-via-saved-views.md](./inbox-via-saved-views.md) — manager inbox via Twenty saved views, no custom UI
- [missed-call-to-task-workflow.md](./missed-call-to-task-workflow.md) — auto-create a Task on missed inbound call via Twenty Workflow

### AI agent integrations

- [voice-agent-context-queries.md](./voice-agent-context-queries.md) — query patterns for Retell / Vapi / similar AI agents reading Person history before a call
- [optout-via-n8n-llm.md](./optout-via-n8n-llm.md) — inbound-SMS intent classification with an LLM, mapping to `Person.doNotSms` / `Person.doNotCall`

### Outbound SMS analytics

- [analytics-tags-on-send.md](./analytics-tags-on-send.md) — tagging outbound SMS with `category` / `source` / `templateName` / `campaignId` for native Twenty group_by dashboards

## When to add a recipe vs. extend an existing one

- **New recipe** — when the use-case has its own trigger and decision tree, not a parameter of an existing pattern.
- **Extend existing** — when the new variant is the same pattern with a different filter or output target. Add a `## Variants` section to the recipe.

## When NOT to write a recipe

- When the answer is "use Twenty's standard feature X" — link to Twenty's own docs from a single short paragraph in the affected recipe instead of duplicating.
- When the pattern is workspace-specific (e.g. a Polish lead-flow callback cycle). Workspace-specific automation lives in the operator's own n8n / Twenty Workflow library, not in this open-source playbook.

## Cross-references

- `docs/ACTIVE_CALL_LOCK.md` — consumer contract for `Person.activeCallStatus` + Twenty Workflow recipe for COOLDOWN → IDLE auto-reset.
- `docs/AI_ENRICHMENT.md` — full contract for the vendor-agnostic `/zadarma/call-enrichment` endpoint plus Retell field mapping.
- `docs/IMPORT.md` — historical-data ingest playbook (canonical CSV + Re-link orphans button).
- `.claude/skills/` (gitignored) — AI-discoverable how-tos for developers shipping Twenty Apps.
