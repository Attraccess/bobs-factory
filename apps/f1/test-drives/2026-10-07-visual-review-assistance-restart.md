# Visual-review assistance survives restart

Date: 2026-10-07. Tested revision: `882b9d94` plus the uncommitted BF38-006 fix
in `WorkflowRuntime.ts` and its regression tests. This runtime recovery change
requires F1 validation; distribution, migration and other settled findings were
not changed.

An isolated EdgeWorker used `F1_AGENT_MODE=mock` and injected `MockAgentRunner`
for every role. It launched through F1 issue creation and session startup, used
the real QA visual gate and review-recovery logic, and accepted answers through
the real HTTP endpoint. It used a disposable repository/home and its own capacity
pool. Background title generation was disabled. No provider credits were used.

## Results

- A rejected unchanged mock fix received reviewer reassessment, then waited at
  the visual gate with the consequential finding still open and unapproved.
- Two worker shutdown/restart cycles retained the exact questions, step and
  batch ID. Saved history and frozen workflow were unchanged. No reviewer,
  capture or fixer replayed, no answer was generated, and only one question
  notification fired.
- Changing the finding summary changed the assistance question on the third
  restart. A new batch and second notification were generated. Submitting the
  original saved answer context returned HTTP 409 and recorded no answer.
- A fourth restart preserved the updated batch. Submitting its saved context
  returned HTTP 200 and resumed the existing fixer, followed by fresh review.
  There was one capture, two fixer turns and three reviews in total. Completion
  means the gate accepted resolved scripted evidence; no human approval or merge
  occurred.
- F1 session activities included responses, and all simulated results reported
  zero cost. Cleanup stopped the worker and freed its ports. Final capacity had
  zero active or queued requests.

## Commands and evidence

```sh
pnpm --filter bobs-factory-edge-worker build
pnpm --filter bobs-factory-edge-worker exec vitest run test/WorkflowRuntime.test.ts test/ReviewRecovery.test.ts test/FactoryPipeline.test.ts test/FactoryServer.test.ts
F1_AGENT_MODE=mock bun run /Users/jappy/.cyrus/factory/evidence/manual-7f0c7c6e-cca1-4387-b7ee-7d81e06997ba/review-assistance-restart/drive.ts
```

All 155 focused tests passed. Before the fix, the unchanged-question regression
failed because restart generated a new batch ID. The changed-question case
passed before and after the fix. Build, EdgeWorker typecheck and targeted Biome
checks passed.

Driver, log, contexts and receipt are retained under
`/Users/jappy/.cyrus/factory/evidence/manual-7f0c7c6e-cca1-4387-b7ee-7d81e06997ba/review-assistance-restart/`.
Complete run JSON and disposable worker state are at
`/tmp/factory-review-recovery-f1-SdgdFG`.
The first fixture attempt retained a removed default workflow and refused startup;
selecting its sole visual workflow corrected the fixture before the passing drive.

This is simulated-agent orchestration evidence. It does not establish real model
reasoning, real protected deployment access, browser interaction or current remote
Taskbot state. Existing platform/Cursor exclusions, security exception, external
catalog and publication limitations remain unchanged.
