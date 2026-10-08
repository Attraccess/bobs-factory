# Web Push and Codex startup recovery integration

Date: 2026-10-07

Validated the merge of Web Push head `057b71c2` and main `0de51ccf` before the merge commit. The only conflict was in the changelog; both fix entries are retained. No Web Push or recovery behavior was rewritten.

An embedded F1 EdgeWorker used a fresh Git repository and Cyrus home. Factory HTTP and F1 RPC stayed on loopback ports 3569 and 3669. All agents were simulated or used an in-process controlled Codex backend; a recording sender replaced browser push services. No native agent or provider-credit call ran.

## Assertions and results

All three cases passed: initialization failure before thread creation, legacy synthetic startup ID followed by a missing-rollout failure, and failure after a confirmed thread began. Each case was restarted and retried through the guarded Factory HTTP endpoint.

- Fresh startup failure retained no invented conversation. Legacy recovery removed only its invalid checkpoint. Confirmed conversation recovery retained its thread ID.
- Completed clarification and scope history survived unchanged; each role ran once. Capture visit allowances survived retry; all runs completed.
- The registered simulated device received exactly one failure and one completion per run. Restart did not replay failure, and settled completion did not repeat.
- F1 session activities and paged Factory activities remained accessible. All agent results reported zero provider cost. Cleanup left no active or queued execution and stopped the worker.

## Commands and evidence

```sh
F1_AGENT_MODE=mock bun run /Users/jappy/.cyrus/factory/evidence/manual-56a8faa8-c83d-4083-a81b-b98174357df8/ci-startup-integration.ts
pnpm --filter cyrus-codex-runner test:run
pnpm --filter cyrus-edge-worker exec vitest run test/WorkflowRuntime.test.ts test/FactoryPush.test.ts test/FactoryServer.test.ts test/EdgeWorker.capture-recovery.test.ts test/AgentSessionManager.codex-runner-activity.test.ts
pnpm build
pnpm typecheck
pnpm biome ci
```

The drive printed `F1_STARTUP_RECOVERY_PASS`. Driver and log are in the supplied evidence directory; run records, activity output and receipts are in its `ci-startup-l7iPBP` directory. The 84 runner tests and 148 focused Factory tests passed. Build and typecheck passed. Biome passed with 29 existing warnings.

This evidence establishes lifecycle, restart and notification bookkeeping with simulated agents and delivery. Native notification receipt, trusted OS clicks, physical-device coverage and production Tailscale behavior remain unverified. The existing accepted dependency exception and tracker snapshot synchronization discrepancy remain limitations. Historical evidence is retained.
