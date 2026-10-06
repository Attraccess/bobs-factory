# Factory handoff waits for transient readiness

Date: 2026-10-06

Tested candidate: `d1527034` plus the working-tree factory recovery fixes.

## Changed behavior

GitHub can return UNKNOWN mergeability after CI and the review guide have passed.
Handoff must poll through that temporary state and running checks, retain completed
review work, and report current readiness. A changed revision, dirty worktree,
actionable feedback, or cancellation must still prevent publication. Stock
handoff routes actionable blockers through its existing CI fixer and review
cycle; recipes without a configured recovery route still stop with the reason.

## Drive

Ran `node /tmp/f1-handoff-wait.mjs` against an isolated CLI EdgeWorker with the F1
`CLIIssueTrackerService`, a fresh Git repository, and HTTP ports 3602/3603. Created
ticket DEF-1 and a saved failed factory run at `pipeline/handoff`. A temporary
`gh` executable returned UNKNOWN on the first GraphQL poll, then readiness for
human review on the same revision. No requests reached GitHub.

- POST `/api/runs/handoff-drive/retry` returned 202.
- The run stayed running during UNKNOWN with a saved readiness blocker and no
  handoff output. It polled again after the normal ten-second interval.
- The run reached `pipeline/human-review` with a pending review gate.
- The original guide/history remained intact. Only handoff and human-review
  steps were added; completed agent steps were not replayed.
- Exactly one handoff comment reached the CLI ticket. The factory activity API
  included "GitHub is calculating mergeability".
- The worker stopped cleanly and temporary state, repository, and CLI were removed.

The initial drive reached human review but used `comments.length` instead of the
tracker connection's `comments.nodes.length` in its assertion. The corrected
drive passed.

A second drive, `node /tmp/f1-handoff-wait.mjs --conflict`, started with a saved
branchless handoff definition. GitHub transitioned from UNKNOWN to CONFLICTING
and then ready. Deterministic agent hooks supplied fixture fixer/reviewer results
without invoking an external runner. The saved definition gained only the existing
CI recovery branch, passed through `ci-fix`, code review, visual scope and guide,
and reached human review. The original guide/history remained intact; planning,
implementation and capture were not replayed. Exactly one handoff comment was
published. The worker and temporary state were cleaned up.

## Other validation and limits

120 focused tests passed across the factory pipeline, merge readiness, workflow
runtime, EdgeWorker merge recovery, and factory HTTP server. The edge-worker
package build and TypeScript checks passed. Regression tests cover pending checks
as well as revision, worktree, feedback, and cancellation guards while waiting.
They also cover actionable blocker receipts, conservative recipe upgrades, and
dispatch of a saved handoff through its existing fixer with history retained.

This drive simulates GitHub's transient response rather than forcing a real
provider recalculation or having a real runner resolve a conflict. The production
incident independently reproduced UNKNOWN mergeability on PR #12, followed by a
concrete conflict blocker after the local retry.
