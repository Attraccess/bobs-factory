# Test drive: interrupted native workflow recovery QA fixes

Date: 2026-10-10. Source commit: `5b7d7c5c1840499c4e4514994ade3ff67edd81e7`. PR: [#83](https://github.com/jappyjan/bobs-factory/pull/83).

Ticket Simple Resume now continues the saved conversation and pending attachments.
Missing repositories and incomplete startup return an error while retaining the
recovery block and ticket ownership. Re-enabling still requires individual Resume.

## Scope and reproducible checks

F1 applies because this fixes ticket routing and runner/session recovery. All
provider and title execution used simulated agents, fresh temporary homes and Git
repositories, and private capacity storage. The SDK pending-work test uses the
installed ClaudeRunner with a controlled SDK query; it does not invoke Claude.

```sh
F1_AGENT_MODE=mock F1_RECEIPT_PATH=/tmp/workflow-native-qa.json node apps/f1/test-drives/assets/run-workflow-catalog-129.mjs
pnpm --filter bobs-factory-edge-worker exec vitest run test/WorkflowNativeRecovery.test.ts test/WorkflowPendingWorkAdmission.test.ts test/WorkflowMigrationIdentity.test.ts test/WorkflowCatalog.test.ts test/WorkflowRuntime.test.ts test/FactoryPipeline.test.ts test/TicketDelivery.test.ts test/RunnerConcurrency.test.ts test/MachineCapacity.test.ts test/IntegrationCapacity.test.ts --maxWorkers=1
pnpm --filter bobs-factory-mcp-tools exec vitest run test/factory-operator.integration.test.ts --maxWorkers=1
pnpm --filter bobs-factory-edge-worker typecheck
pnpm --filter bobs-factory-edge-worker build
pnpm lint
```

For the test commands, remove inherited `BOBS_FACTORY_*` and `CYRUS_*` settings
and use private `BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY` storage. The
F1 wrapper already removes these settings and the fixture supplies private storage.
The isolated test run passed **273/273** checks; operator checks passed **12/12**.
The full monorepo build and type checks also passed in the pre-commit hook.
Lint passed with zero errors and 19 warnings in unchanged files. A first run of
the wider tests inherited the managed binary sandbox settings, causing two Cursor
configuration assertions to fail; the isolated rerun passed all 273 checks.

## Observed results

- Current live ticket session, rather than a retained stale object, kept its native
  ID after both queued and active interruption. The resumed runner supplied the
  saved thread ID, pending body and `note.txt` attachment manifest.
- Supplemental F1 also changed the catalog's native model preference while blocked.
  Resume retained the already accepted native settings and attachment metadata.
- Removing the saved repository returned HTTP 409 with `Session repository is
  unavailable`. The original block, pending input and recovery ownership remained.
  Restoring that repository and explicitly resuming returned HTTP 202 and kept the
  same conversation.
- The protected issue-tracker RPC flow created a ticket, launched Simple, accepted
  replies and recorded timeline activities. Stop/capacity cleanup and private server
  shutdown completed. Manual Simple operator recovery and saved graph question
  restoration also passed.
- Controlled scheduled wakeup and background-task callbacks ran while enabled.
  Disabling aborted the real runner's SDK query, prevented later callbacks, released
  capacity and blocked further starts. Enabling left the durable block in place.
- All three generated migration identity collisions were constructed. Each failed
  on both attempts without replacing the original configuration. Only the source
  file digest was controlled because the occupied ID embeds that same file's digest.
- Saved runtime, pipeline, delivery, tracking and older-run scheduling suites passed.
  The previous accepted graph/checkpoint evidence remains intact; this fix adds the
  previously failing native-conversation proof.

## Evidence and limits

[Revision-bound receipt](assets/workflow-native-qa-fixes/receipt.json) contains
native IDs, retained input/settings, missing-repository response and block, test
counts and controlled pending-work/collision observations. Detailed fresh logs and
the supplemental driver are in the run evidence directory under `qa-fix-*`.
The strengthened committed F1 fixture is
[workflow-catalog-129.ts](assets/workflow-catalog-129.ts).

No real agents or external services were invoked. No UI source changed, so no new
screenshots or playback are claimed. Previous visual acceptance remains history.
Reviewer reassessment, CI, subsequent QA and human approval remain required; the
PR stays draft and unmerged.
