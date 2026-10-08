# Codex startup checkpoint recovery

**Date:** 2026-10-07

**Base commit:** `b317ea9e`, with the startup/checkpoint fix in the working tree

**Behavior:** failed startup must not invent a resumable Codex conversation;
explicit Retry can remove a proven legacy startup checkpoint while retaining
completed workflow work and established conversations.

## Scenario and boundary

The applicable change is runner/session lifecycle and persisted Factory retry.
An embedded F1 EdgeWorker used a fresh Git repository and Cyrus home, CLI RPC
on port 3600, Factory HTTP on port 3540 and capacity 1. Background titles were
disabled. All agent creation was intercepted: ordinary roles used
`MockAgentRunner`; the current `CodexRunner` used an in-process controlled
backend for startup failures. A scripted legacy runner reproduced the old
synthetic init and zero-usage error receipts through `CodexEventMapper`.
No native Codex process, inference, real ticket, GitHub operation or production
run was used by the F1 drive.

The nested recipe was `pipeline → clarify → visual-scope → capture →
visual-review → visual-gate`. Each case created an issue and session through
F1, failed capture, stopped/recreated the worker with the same home, and
retried through the protected HTTP endpoint. Mocked QA outputs passed the
ordinary QA contracts and gate.

## Results

| Case | Capture resume IDs, in order | Result |
| --- | --- | --- |
| Current runner fails initialization before thread creation | absent, absent | No agent checkpoint; restart and Retry complete |
| Legacy init timeout followed by missing-rollout failure | absent, synthetic ID, absent | Only the invalid agent checkpoint is removed; restart and Retry complete |
| Confirmed thread fails during its turn | absent, confirmed ID | Genuine conversation is resumed; restart and Retry complete |

- All three runs completed. Clarification and QA scope each executed once per
  run; their exact history receipts survived restart and retry.
- Capture retained pass 1 across retry. Legacy recovery logged its checkpoint
  removal; confirmed-thread recovery retained the native ID.
- F1 `view-session` returned session/activity output. The Factory paged activity
  endpoint returned recorded entries/events for each completed run.
- Every scripted agent result reported zero provider cost. At cleanup the
  instance had active=0 and queued=0; its worker stopped cleanly.

## Commands and evidence

```sh
bun run /tmp/bobs-codex-startup-f1.ts
bun run /tmp/bobs-startup-fixed-probe.ts
bun run /tmp/bobs-codex-saved-recovery.ts
pnpm --filter cyrus-codex-runner test:run
pnpm --filter cyrus-edge-worker exec vitest run test/WorkflowRuntime.test.ts test/EdgeWorker.capture-recovery.test.ts test/AgentSessionManager.codex-runner-activity.test.ts test/FactoryServer.test.ts
pnpm typecheck
pnpm build
```

The final drive printed `F1_STARTUP_RECOVERY_PASS`. Local scripted fixtures
remain at the command paths above. Receipts, three complete run records and
F1 activity text are in `/tmp/bobs-codex-startup-f1-JAhiRu`; the drive log is
`/tmp/bobs-codex-startup-f1-final.log`.

The focused before/after probe reproduced the synthetic init followed by
missing-rollout failure before the change. Afterward it printed `FIXED`:
neither failed startup nor its retry published an invented init.

A separate copy of the reported persisted run printed
`ACTUAL_SAVED_RUN_RECOVERY_PASS`. It replaced only the invalid
`pipeline/capture` agent checkpoint, retained capture pass 4, all 65 history
receipts, outputs, answers and additional review allowances, and preserved
the replacement checkpoint across save/reload. The original record was
byte-for-byte unchanged by that probe.

Runner tests passed: 84. Targeted Factory tests passed: 136. Root typecheck
and build passed; the final recovery-guard adjustment also passed the
affected package's build and typecheck. Negative regressions preserve
checkpoints with established activity, turn failures, missing or truncated
evidence, completed visits, saved outputs/corrections or other providers.

This validates orchestration, persistence and adapter lifecycle under
controlled failures. It does not diagnose why a particular native app-server
initialization timed out or claim native QA/model behavior.
