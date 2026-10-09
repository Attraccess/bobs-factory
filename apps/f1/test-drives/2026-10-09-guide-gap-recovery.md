# Guide gap recovery

Date: 2026-10-09. Tested the working tree based on `7a08db4f` with the guide
recovery changes. Driver: `/tmp/bobs-guide-gap-f1.ts`. Successful evidence:
`/tmp/bobs-guide-gap-f1-NDrZDS`; command log: `/tmp/bobs-guide-gap-f1.log`.

## Changed behavior and reproduction

Run `0610633f-939a-42e4-aa10-0d9520c01a6f` failed at `pipeline/handoff` with
`Review guide reports unresolved gaps; handoff blocked`. Its code and QA gates
were approved, but the guide reported that the delivered PR differed from the
accepted continuation plan without reconciliation. Handoff threw instead of
returning corrective work to its configured fixer.

Handoff now preserves guide criteria and evidence in its correction receipt,
routes gaps and unverified requirements through the configured correction branch,
and refuses publication until the guide and revision gates permit it. Repeated
gaps at the same URL/head/base and unchanged human instructions wait for specific
assistance after a corrective attempt. Answering resumes correction without
waiving requirements or supplying human approval. Fixers receive guide and
handoff context even when their recipe inputs are restricted.

## Applicable F1 scenarios

Runner/workflow lifecycle and activity output changed, so F1 applies. The driver
used a fresh repository, real isolated Git worktrees, a CLI-platform EdgeWorker,
RPC port 3600, protected Factory API port 3540 and deterministic MockAgentRunner
responses. GitHub responses were scripted. No native coding agent or inference
API was invoked.

Command:

```sh
F1_AGENT_MODE=mock bun /tmp/bobs-guide-gap-f1.ts
```

Both issues were created and started through the F1 CLI. The custom workflow
exercised guide generation, handoff, correction, regenerated guide and explicit
human review. The fixer deliberately restricted its inputs to `plan`; the driver
asserted that runtime `/feedback/guide`, `/feedback/handoff` and human instructions
still exposed the missing delivery criterion and recovery guidance.

- **Automatic correction:** first guide declared a delivery gap. Handoff routed
  it to the fixer once, then generated a second guide and reached human review.
  No answer was needed and no guide was published before correction.
- **Unresolved correction and restart:** an unchanged first corrective attempt
  retained the gap. Handoff waited with the concrete criterion and evidence
  instead of failing or repeatedly invoking the fixer. Worker shutdown/restart
  preserved the pending question and all completed role receipts, with no extra
  fixer execution. A protected API answer resumed correction; the next guide
  passed and reached human review.

Successful receipt:

```text
                         guides  fixer turns  answers  final checkpoint
automatic                     2            1        0  human-review (waiting)
assistance with restart       3            2        1  human-review (waiting)
```

Both human gates retained the exact current HEAD. No human approval was invented
and neither run merged. Exactly two provider description publications occurred,
one for each corrected guide. F1 `view-session` returned real session activity;
workflow events recorded correction and assistance. No unhandled rejection
occurred, shutdown completed, and both test ports were released.

Initial fixture attempts exposed setup errors: the legacy-capacity check needed
an isolated migration-source directory, the F1 CLI needed building, and restricted
fixer inputs required reading original input/answers from the runtime feedback
context. Those attempts were stopped; passing evidence comes from the corrected
fresh run above.

## Additional verification and limits

Targeted FactoryPipeline, FeedbackPolicy, WorkflowRuntime, Guide and
FactoryRepositoryScope tests cover correction, repeated gaps, grouped delivery
history, answers, ready decisions with contradictory coverage, missing correction
routes and keeping assistance waits in progress. Build, type checking and Biome
checks passed.

This validates mocked orchestration and restart behavior. It does not prove a
real agent can reconcile the production PRs or resolve the tracker conflict. The
live run and its repository were inspected read-only and were not resumed or
modified. Stock correction branches still own subsequent review/CI/QA; this
focused drive used a metadata-only custom workflow and did not repeat live QA.

The same mocked drive passed again after merging latest main (`8fc64e7e`)
into revision `8e996581`, including the refreshed full routing prompt fixture.
Evidence: `/tmp/bobs-guide-gap-f1-nRQdsq`; log:
`/tmp/bobs-guide-gap-f1-latest.log`. Both scenarios retained the same expected
counts and human-review checkpoints. The full workspace test run passed with
3,214 tests and two skips; normal build and type-check gates also passed.
