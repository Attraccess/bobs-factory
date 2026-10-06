# Factory merge confirmation after worktree cleanup

Date: 2026-10-06

Tested candidate: `d1527034` plus the working-tree merge recovery fix.

## Changed behavior

A PR can merge and trigger issue/worktree cleanup before the factory records
completion. Provider polling must survive that cleanup. Retry of the final merge
checkpoint must confirm the explicitly approved revision through GitHub, retain
prior results, and complete and settle the run. Missing worktrees still block
unfinished work, open PRs, and mismatched revisions.

## Drive

Ran `node /tmp/f1-merge-recovery.mjs` against an isolated CLI EdgeWorker using the
F1 `CLIIssueTrackerService`, a fresh Git repository, and HTTP ports 3602/3603
(3600 was occupied). The script created ticket DEF-1 and two saved nested factory
runs at `pipeline/merge`, with an approved revision and missing worktree. A
temporary `gh` executable returned deterministic provider receipts; it did not
contact or mutate GitHub.

- POST `/api/runs/drive-MERGED/retry` returned 202. The approved merged revision
  completed the saved graph, retained the guide/history, recorded the merge
  receipt, and persisted a settled view state.
- GET `/api/runs/drive-MERGED/activity` included the provider confirmation in the
  conversation timeline.
- An OPEN receipt retained the missing-worktree failure and produced no merge
  receipt.
- Both provider checks used the retained repository directory and only executed
  `gh pr view`. No worktree was recreated and no merge command was issued.
- The worker stopped cleanly; the temporary repository, fake CLI, and state were
  removed.

The first attempt could not bind occupied port 3600. A subsequent assertion was
corrected to compare canonical macOS paths (`/var` resolves to `/private/var`).
The final drive passed, including after the saved-receipt recovery update.

## Other validation and limits

109 focused tests passed across merge readiness, EdgeWorker recovery, factory
pipeline, workflow runtime, and factory HTTP server. TypeScript and the package
build passed. Regression tests also reject a different merged revision, missing
approval, and unfinished/nonterminal workflow steps; they preserve an already
saved merge receipt without duplication.

The isolated drive simulates the provider's terminal state and a missing checkout;
it does not exercise live Linear cleanup webhooks or perform a real GitHub merge.
The production incident independently confirmed that PR #1938 had already merged
at its approved revision before the run failed.
