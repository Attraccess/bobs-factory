# Specialist review waits for concurrent runner cleanup

Date: 2026-10-08. PR: [#32](https://github.com/Attraccess/bobs-factory/pull/32).
Tested `6e664de34b7f50272178b9d5699f3cbebd503bf2` with the uncommitted
SR-005 fix in `WorkflowRuntime.ts` and `SpecialistReview.ts`.

Specialist leaves still check that HEAD matches the frozen reviewed commit.
Worktree cleanliness is checked at the fanout join after all runner hooks finish
and clean up, and again at the aggregate gate. No runner directory is exempt.

## Simulated-agent F1 drive

Command from the repository root:

```sh
F1_AGENT_MODE=mock env -u BOBS_FACTORY_INTERNAL_EXECUTABLE node \
  /Users/jappy/.cyrus/factory/evidence/manual-0b7cf77f-8296-4e61-9df5-b03561e59729/fix-r14/mixed-f1.mjs
```

The compiled EdgeWorker uses a temporary repository, Factory home and capacity
pool, with separate listener ports 4896/4897. F1 creates five issues and starts
five sessions through its CLI. The configured fanout has a Cursor security
reviewer and a Codex requirement-coverage reviewer. Provider calls are injected
simulations; Cursor configuration installation and cleanup use production code.
The fixture does not ignore `.cursor` paths.

All five assertions passed:

1. The coverage reviewer completes while the Cursor reviewer still owns temporary
   configuration. Git reports `?? .cursor/` at that point. After Cursor cleanup,
   the fanout and aggregate approve complete R1 coverage against the shared HEAD,
   and the worktree is clean.
2. A tracked product edit blocks the round before fanout output or approval.
3. An untracked product file blocks the round before fanout output or approval.
4. An edit to `.cursor/hooks.json` remaining after cleanup blocks the round.
5. A reviewer commit invalidates the frozen revision and prevents approval.

Every session has observable F1 activities. Worker shutdown and temporary-home
cleanup completed. Scripts, full results, commands, activities, failed logs and
cleanup receipts are in the evidence directory above. The final successful log
is `mixed-f1-passed.log`; assertions are in `mixed-f1-results.json`.

The initial fixture omitted isolation of the legacy-capacity migration check.
Its next version omitted ignore rules for unrelated generated agent context.
After those setup corrections, a six-reviewer fixture succeeded once, then its
artificial waiting callbacks filled all four capacity slots ahead of Cursor.
The final fixture uses the two relevant reviewers and abortable waits, preserving
the concurrency and mutation assertions without that test-driver deadlock.
No product change was needed to correct fixture setup. Failed evidence is kept.

## Focused checks

- 222 tests in six suites passed with `F1_AGENT_MODE=mock`:
  SpecialistReview, WorkflowRuntime, FactoryPipeline, FactoryExecution, Guide
  and ReviewRecovery. New tests cover real Cursor artifact setup/cleanup and
  tracked, untracked, runner-directory and commit mutations.
- Edge-worker build and typecheck passed.
- Biome CI on all three changed TypeScript files and `git diff --check` passed.

Real-agent reasoning, external provider connectivity and current remote CI are
not established by this evidence. Historical recovery limitations are retained.
No browser/UI changes, human approval, PR readiness change or merge occurred.
