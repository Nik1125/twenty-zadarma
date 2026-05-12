import { defineLogicFunction } from 'twenty-sdk/define';
import { CoreApiClient } from 'twenty-client-sdk/core';

import { sweepStaleCooldowns } from 'src/modules/zadarma/utils/sweep-stale-cooldowns';

// Server-side cron that fires every minute and clears any Person whose
// activeCallCooldownUntil has elapsed back to IDLE. Required because the
// Twenty App SDK's logic-function runtime spawns a fresh node child-process
// per invocation and immediately calls process.exit(0) after the handler
// resolves (see twenty-server `local.driver.ts` writeBootstrapRunner) —
// any setTimeout queued inside the handler dies with the process. Cron is
// the only event-driven timer-replacement Twenty exposes to App authors.
//
// Pattern '* * * * *' = once per minute. Slack window for cooldowns ≈ up
// to 1 minute past expiry before the sweep flips them. Acceptable for any
// ACTIVE_CALL_COOLDOWN_MINUTES value (default 5, valid range [1, 1440]).
//
// Cost: ~1 GraphQL query per minute per workspace + 0–N small mutations
// when there is a backlog. Same isolated child-process model as HTTP
// route handlers — no UI thread, no Twenty Workflow visibility, no impact
// on operator-facing latency.
//
// The webhook-entry sweep in handle-zadarma-pbx-webhook stays as
// defense-in-depth (faster recovery if a call lands while a cooldown is
// expiring), but this cron is the canonical clear path.
const handler = async () => {
  const client = new CoreApiClient();
  return await sweepStaleCooldowns(client);
};

export default defineLogicFunction({
  universalIdentifier: '71af1328-8478-488e-af46-b5f238060866',
  name: 'sweep-stale-cooldowns-cron',
  description:
    'Every minute, clears Person.activeCallStatus = COOLDOWN back to IDLE for any Person whose activeCallCooldownUntil has elapsed. Replaces the in-handler setTimeout pattern (which the Twenty logic-function runtime kills when the handler returns).',
  timeoutSeconds: 30,
  handler,
  cronTriggerSettings: {
    pattern: '* * * * *',
  },
});
