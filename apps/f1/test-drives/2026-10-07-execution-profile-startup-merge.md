# Execution profiles and current startup recovery

Date: 2026-10-07. Tested the merge of PR head `7fd12c0d` and base
`0de51ccf` before its merge commit.

## Scope

Only the changelog conflicted. Both histories are retained. The automatic
code merge adds Codex startup checkpoint recovery and human communication
guidance while retaining execution-profile admission, environments and recovery.
No frontend source changed in this integration.

F1 applies to the integrated runner lifecycle and generated instructions.
The existing startup and communication fixtures ran against this worktree's
built code, using fresh repositories and Cyrus homes. All agent calls used
simulated agents or an in-process controlled Codex backend. No native provider
process or paid inference ran.

## Checks

```sh
pnpm build
pnpm typecheck
pnpm --filter cyrus-edge-worker exec vitest run test/WorkflowRuntime.test.ts test/EdgeWorker.capture-recovery.test.ts test/RunnerConfigBuilder.prompt-addenda.test.ts test/FactoryExecution.test.ts test/ExecutionProfiles.test.ts test/NativeExecutionShare.test.ts test/ExecutionCapabilities.test.ts test/AgentSessionManager.codex-runner-activity.test.ts
pnpm --filter cyrus-codex-runner test:run
F1_AGENT_MODE=mock bun run /tmp/ci57-r4-startup-f1.ts
F1_AGENT_MODE=mock node /tmp/bob-human-language-f1.mjs
pnpm biome ci
```

- Build and type checks passed.
- EdgeWorker: 167 tests passed. Codex runner: 96 tests passed.
- Startup F1: three scenarios completed after restart and Retry. A new failed
  startup retained no conversation; a proven legacy synthetic checkpoint was
  removed; a confirmed conversation resumed with its original ID. Completed
  clarification and scope receipts survived, and activity output was available.
- Communication F1: a saved fixer with `askQuestions: false` received the complete
  guidance and retained its original prompt. Questions reached the API and tracker
  activities. An explanation-only reply kept the run waiting; an explicit fixture
  answer completed it. All three fixer invocations used simulated agents.
- Both fixtures stopped cleanly. Startup capacity ended with no active or queued
  requests. Biome passed with existing warnings.

## Evidence and limits

Startup receipts: `/tmp/bobs-codex-startup-f1-KUKMjC/receipts.json`.
Communication receipts:
`/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/bob-human-language-f1-jhHLmc/receipts.json`.
Logs: `/tmp/ci57-r4-startup-f1.log` and `/tmp/ci57-r4-language-f1.log`.
The startup fixture is the prior fixture with repository imports redirected to
this worktree. Historical F1 reports remain intact.

These checks establish orchestration and controlled failure recovery, not native
model behavior. Previously waived live runner/GitLab tests, unverified live Codex
subscription and GitHub App authentication, and the ticket synchronization
discrepancy remain limitations.
