# Track corrective handoffs as work in progress

Date: 2026-10-06

Tested candidate: `88c16a03` plus the handoff tracking fix for PR #19.

The runtime must keep tickets In Progress when a handoff returns `fix: true`,
post the actionable blockers, and move to In Review only after a successful
handoff. A failing fixer must retain the corrective-work status.

Ran `node <evidence-directory>/handoff-fix-drive.mjs` from the worktree against
an isolated CLI EdgeWorker, fresh Git repository, CLI issue tracker and HTTP
ports 3608/3609. The script and log are retained in the factory evidence directory
`manual-df3a6623-c843-44af-8926-fdc200996962`.

- Created a CLI ticket and recorded an earlier In Review milestone.
- Retried a saved nested handoff through the Factory HTTP API. A local `gh`
  fixture reported merge conflicts, and the deterministic fixer threw.
- Verified the run failed at `pipeline/ci-fix`, the ticket was In Progress,
  and its comment included the conflict and PR URL with no false readiness.
- Retried with a successful fixer and ready provider response. The run reached
  `pipeline/human-review` with pending approval, and the ticket became In Review.
- Verified exactly one correction comment, one readiness comment and one PR
  attachment, preserved guide history, and no replay of planning, implementation
  or capture. The blocker also appeared in Factory activities.
- Stopped the worker and removed its temporary state and repository.

The first drive passed the status assertions but used a nonexistent attachment
inspection method. After correcting it to `fetchIssueAttachments`, all assertions
passed. GitHub responses and agent results were fixtures; no production tickets
or PRs were mutated. Frozen pre-QA steps isolate this tracking scenario from
unrelated capture prerequisites.

All 134 focused tests passed across WorkflowRuntime, TicketTracking,
FactoryPipeline and MergeReadiness. New regression cases cover a failing fixer,
resuming a saved handoff result without replaying the tool, and successful
handoff status. Full build, typecheck, changed-file Biome and diff checks passed.
