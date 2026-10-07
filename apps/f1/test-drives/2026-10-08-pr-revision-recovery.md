# PR revision mismatch recovery

Date: 2026-10-08. Tested changes based on `73f9ce45` in the working tree.
Evidence: `/tmp/bobs-pr-revision-f1-cepq3d`; driver:
`/tmp/bobs-pr-revision-drive.ts`; log: `/tmp/bobs-pr-revision-drive.log`.

## Applicability and execution

F1 applies to the changed Factory CI and recovery lifecycle. A real CLI-platform
EdgeWorker used a fresh Git repository, private Factory home, one-slot instance
capacity pool, RPC 3600 and dashboard 3540. Every agent was a deterministic
MockAgentRunner; GitHub responses were controlled fixtures. No native agent CLI,
inference API or actual PR mutation was invoked. Dashboard reads, retry and answer
requests used a private expiring authentication fixture through the real API.
The migration-source capacity guard pointed to an isolated fixture directory;
it did not inspect or change the running operator instance's coordinator.

Command:

```sh
BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY=/tmp/bobs-pr-revision-isolated-legacy-capacity \
  bun run /tmp/bobs-pr-revision-drive.ts
```

All three scenarios began through `apps/f1/f1 create-issue` and `start-session`,
using a frozen nested pipeline with the real CI, review-after-fix and review-gate
tools:

- **Successful synchronization:** CI saw an old PR head and passing old checks.
  Its receipt retained both revisions, denied approval/readiness and routed to
  the configured fixer. The fixer synchronized the fixture provider. Fresh code
  review, review gate and CI ran; the run completed. One fixer and two code reviews.
- **Persistent mismatch:** one unsuccessful synchronization attempt reached a
  specific assistance wait without another review/fixer loop. Shutdown and worker
  replacement preserved the question, history and role counts. A dashboard answer
  resumed the existing recovery path, synchronized the provider and completed
  after fresh review and CI. Two fixers and two code reviews in total.
- **Previously failed checkpoint:** a controlled legacy CI exception saved the
  exact reported error and nested executing checkpoint. Worker replacement retained
  the failed state and completed work. `POST /api/runs/:id/retry` recovered through
  the configured fixer and fresh review/CI. One fixer and two code reviews; neither
  clarification nor draft preparation repeated.

`receipts.json` and the three full run JSON files retain exact history, revisions
and events. F1 session activity reads contained final responses; all mock results
had zero cost. The final capacity pool had zero active/queued requests. The worker
stopped cleanly and both fixture listeners closed. The legacy exception above was
intentional; successful recovery had no unexpected errors.

## Focused regression evidence

Before the fix, the new CI routing test rejected with
`PR must match the current pushed worktree revision`; the persistent mismatch test
returned no assistance question. After the fix, FactoryPipeline, MergeReadiness
and WorkflowRuntime passed all 188 tests. Edge-worker build, typecheck and changed
TypeScript Biome checks passed. Recipes without a configured fix branch retain a
hard revision safeguard; old checks cannot authorize handoff or merge.

This verifies mocked orchestration and restart behavior. It does not establish
that GitHub repairs a stuck PR after any particular live operation.
