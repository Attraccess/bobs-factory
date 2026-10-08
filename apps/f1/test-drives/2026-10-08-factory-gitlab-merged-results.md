# Factory GitLab merged-results CI

**Date:** 2026-10-08
**PR:** [#49](https://github.com/Attraccess/bobs-factory/pull/49)
**Candidate:** `fix/gitlab-merged-results-ci`, based on
`6219aff7d31744e7401a0e4d6200873ed483163c`, with the merged-results working diff.
**Goal:** Accept current GitLab merged-results pipelines while retaining the
source revision for human approval and blocking stale CI evidence.

## Applicability and setup

CI readiness is an F1-covered runtime behavior. The prior provider fixture was
extended with successful merged-results pipelines whose temporary commits had
the current target and source as parents. An embedded EdgeWorker used
`f1AgentHandlers("mock")`, scripted implementation, simulated provider responses,
fresh repositories and an isolated Factory home. Git worktrees, commits, pushes,
protected HTTP requests, issue-tracker RPC and workflow recovery were real.
The temporary commit was also created through Git. No live model was invoked.

The Factory listener used port 3611 and issue-tracker RPC used 3612. Synthetic
authentication existed only in the temporary home. The fixture failed every
`gh` invocation and recorded `glab`/custom-adapter calls.

## Assertions and results

| Scenario | Assertions | Result |
| --- | --- | --- |
| GitLab delivery and retry | Provider outage followed by protected retry; completed implementation ran once; merged pipeline SHA differed from source; commit-parent evidence was fetched; pipeline passed; CI receipt retained source SHA and draft/human gate | Passed |
| Custom forge | Real commit/push and JSON executable protocol remained functional | Passed |
| Ticket assignment | Issue creation, description routing, GitLab publication/CI, retained ticket identity and visible timeline | Passed |
| Merge recovery | Deleted worktree, retained approval/history and provider-confirmed merge at source SHA | Passed |

The server stopped cleanly and removed its temporary root. The intentional
provider outage was handled; no unhandled errors remained.

## Commands and receipts

```sh
F1_AGENT_MODE=mock bun node_modules/.cache/f1-merged-results-drive.ts
pnpm --filter bobs-factory-edge-worker exec vitest run test/GitProvider.test.ts test/MergeReadiness.test.ts test/FactoryPipeline.test.ts
pnpm --filter bobs-factory-edge-worker typecheck
pnpm exec biome check packages/edge-worker/src/factory/GitlabProvider.ts packages/edge-worker/test/GitProvider.test.ts
git diff --check
```

The drive passed all four scenarios. Focused tests passed 96, including the
reproduced failure before the fix and rejection of stale source/target, wrong
commit identity, different MR, branch pipeline and missing parent evidence.
Typecheck passed. Driver, log and receipt are local ignored artifacts:
`node_modules/.cache/f1-merged-results-drive.ts`,
`f1-merged-results-drive.log`, and `f1-merged-results-receipt.json`.

## Live observation and limits

After installing the previous provider binary and using the owner's signed-in
Brave session, the reported run successfully published GitLab MR !6534 and
advanced to code review without repeating completed implementation. A read-only
GitLab probe exposed its merged-results pipeline: its SHA differed from the
source, and its commit parents matched the current target and source. The
updated readiness probe recognized that evidence and retained failed/pending
job blockers rather than falsely calling the revision stale.

This F1 drive establishes mocked/scripted orchestration, not live model or merge
behavior. The read-only probe exercised native GitLab authentication/API; the
target project's actual CI failures remain its workflow's responsibility.
