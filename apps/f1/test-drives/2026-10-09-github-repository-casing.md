# GitHub repository capitalization and publication retry

**Date:** 2026-10-09
**PR:** [#75](https://github.com/jappyjan/bobs-factory/pull/75)
**Candidate:** GitHub identity comparison change based on `7a08db4f`.
**Goal:** Accept GitHub's canonical owner/repository capitalization while keeping
repository, provider, PR-number and approved-head checks intact.

## Reproduction

The reported Factory run retained `https://github.com/JappyJan/bobs-factory`
and failed at `pipeline/draft-pr` with “Pull/merge request must belong to the
selected repository and provider”. A read-only GitHub API query confirmed that
the draft already existed at `https://github.com/jappyjan/bobs-factory/pull/71`.
The repository comparison rejected the capitalization difference after creation.
Regression scenarios reproduced the same error before the fix.

## Applicability and setup

Publication and retry are F1-covered runtime behaviors. An embedded EdgeWorker
used `f1AgentHandlers("mock")`, an isolated Factory home, fresh Git repository,
local bare remote and scripted implementation. Worktree creation, commits,
pushes, protected Factory HTTP requests, F1 issue-tracker RPC and activity
delivery were real. GitHub responses and model output were simulated.

The Factory listener used port 3611 and the F1 RPC listener used 3612. A synthetic
session existed only in the temporary authentication store; ordinary cookie,
Origin and request-header checks remained active.

## Results

- **Manual publication retry:** simulated loss of the creation acknowledgement
  after saving an open draft. Retry reused its lowercase URL despite the retained
  mixed-case repository. Implementation output, history and Git head were
  unchanged; the implementation file contained exactly one execution. Exactly
  one PR creation occurred. Current-head CI passed and the run reached its
  explicit human wait with `reviewReady: true`, `approved: false`.
- **Ticket assignment:** created an F1 issue through RPC, routed its repository
  and workflow description selectors, then created a real worktree, commit and
  local push. The simulated canonical draft URL was accepted, current CI passed,
  and the issue-session timeline contained activities.
- **Cleanup:** stopped both fixture sessions and the worker, closed listeners
  and removed the temporary root. The final drive exited successfully.

## Validation

```sh
F1_AGENT_MODE=mock bun node_modules/.cache/f1-github-casing-drive.ts
pnpm --filter bobs-factory-edge-worker exec vitest run test/GithubApi.test.ts test/GitProvider.test.ts test/FactoryPipeline.test.ts test/MergeReadiness.test.ts test/FactoryRepositoryScope.test.ts test/Takeover.test.ts
pnpm --filter bobs-factory-edge-worker build
pnpm --filter bobs-factory-edge-worker typecheck
pnpm exec biome check packages/edge-worker/src/factory/GitProviderReference.ts packages/edge-worker/src/factory/GitProvider.ts packages/edge-worker/src/factory/GithubProvider.ts packages/edge-worker/src/factory/GithubTakeover.ts packages/edge-worker/test/GithubApi.test.ts packages/edge-worker/test/GitProvider.test.ts
git diff --check
```

All 140 targeted tests passed, along with build, type checking and scoped lint.
Unit scenarios cover public GitHub and Enterprise capitalization, direct merge
and merge queues, and rejection of different PR numbers, repositories, hosts,
queries and credential-bearing URLs. GitLab path comparisons remain strict.
Driver and final log are local ignored artifacts under `node_modules/.cache/`.
The drive initially passed on `57c9ed18` plus the working diff and was repeated
after integrating current main (`7a08db4f`). Workspace commit hooks also validate
the complete build and type checks.

## Limits

The drive establishes mocked orchestration, not live inference or remote merge
execution. The live GitHub observation was read-only. Fixture setup mistakes
(team ID, asynchronous run creation and returned branch name) were corrected
before the successful drive. The production service and reported run were not
modified or retried.
