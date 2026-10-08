# Codex cancellation after a shared turn-start timeout

**Date:** 2026-10-07  
**Finding:** BF38-QA-003  
**Tested code:** `d18414e9732d8407605c808009074c843021fda8` plus the
`AppServerCodexBackend` cancellation-handler changes committed with this report.

Stop previously unregistered its thread while `turn/start` was still pending.
On a shared process, late notifications were discarded. A timed-out response
also bypassed the success-only interrupt callback, leaving remote execution alive.

The backend now preserves a cancellation handler until the thread completes or
the process exits. Late start notifications and successful responses share that
handler. It interrupts only the cancelled thread, suppresses duplicate interrupts
and emits no new activity on the stopped runner. A rejected start request remains
eligible for cancellation because failure does not prove remote execution ended.

## Relevant checks

Runner lifecycle changes require F1. This drive used `F1_AGENT_MODE=mock`, a
prepared Python JSON-RPC process and injected transport configuration. It exercised
the real Codex runner, backend, transport, EdgeWorker, issue tracker and activity
posting without invoking a real agent or inference API. All other runner paths,
including titles, used `f1AgentHandlers('mock')`.

Production capacity identities normally separate processes belonging to distinct
managed executions. This fixture deliberately acquired one isolated transport
outside those identities to exercise concurrent threads on a shared process.
It used a fresh repository, home and legacy-capacity directory. Host credentials
and state were not changed.

```sh
pnpm --filter bobs-factory-codex-runner test:run
pnpm --filter bobs-factory-edge-worker test:run test/MachineCapacity.test.ts test/EdgeWorker.instance-capacity.test.ts test/WorkflowRuntime.test.ts
pnpm --filter bobs-factory-codex-runner build
pnpm --filter bobs-factory-codex-runner typecheck
pnpm exec biome check packages/codex-runner/src/backend/AppServerCodexBackend.ts packages/codex-runner/test/AppServerCodexBackend.test.ts
F1_AGENT_MODE=mock bun "$evidence/qa-shared-stop-f1.ts"
```

Set `evidence` to
`/Users/jappy/.cyrus/factory/evidence/manual-7f0c7c6e-cca1-4387-b7ee-7d81e06997ba`.
The executed harness and `qa-shared-stop-f1-receipts.json` are retained there.

## Results

- All 95 Codex tests and 98 capacity/workflow tests passed. Six new regression
  cases cover start-response and notification ordering, timeouts before and after
  close, completion-handler cleanup, thread resumption and process exit.
- The supplied `review-shared-stop.ts` reproduction changed from zero interrupts
  to one interrupt for the cancelled thread, with its survivor still active.
- F1 created two issues and sessions sharing exactly one scripted process. Stop
  completed while the first turn-start response was pending. The transport's
  two-second request timeout expired before the late start notification arrived.
  That notification produced exactly one interrupt targeting the cancelled thread.
- The cancelled run stayed stopped, with its events unchanged. The survivor
  remained running on the same child, then completed and posted the expected
  response activity. Final release terminated the child and left zero active,
  stopping or queued capacity requests. Worker shutdown closed its listeners.
- Build, typecheck, Biome and diff checks passed. The commit hook also runs the
  required repository build and typecheck.

Initial fixture errors were corrected: include the required issue team ID and
declare plain-text output rather than asking the runtime to parse it as JSON.
Failed fixture logs and homes remain separate from the passing receipt.

## Retained limitations

This proves lifecycle handling with a scripted process, not real-agent reasoning
or provider continuation. Earlier native binary startup/shutdown evidence remains
in `2026-10-07-codex-startup-cancellation.md`; this follow-up did not rebuild release
archives. Existing real-agent exclusions, native platform and publication limits,
the limited dependency-security exception, unverified live ticket synchronization
and external hosted MCP catalog remain. Earlier fixes and visual evidence are
retained; this change does not alter dashboard rendering.
