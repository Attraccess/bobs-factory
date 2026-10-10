# External delivery integration with review briefs

Date: 2026-10-10. Tested the merge worktree based on `df5191c3` with
`origin/main` at `dd7348c3`, before committing this integration.

Main introduces review briefs and a shared approval hook. Integration preserves
external snapshot binding, verified ticket appendices, legacy chapter guides,
and pending-tracking settlement guards. Mixed briefs retain independently
verified ticket before/after content in both the dashboard and PR description.

## Executed checks

- Eight focused files: 256 tests passed, including delivery, tracking, runtime,
  pipeline, legacy guides, briefs and review feedback/state.
- Final delivery/brief tests: 30 passed, including two new regressions for mixed
  evidence attachment, stale verification rejection and Markdown publication.
- Edge-worker build, including web TypeScript, passed.
- Simulated-agent F1:
  `env -u BOBS_FACTORY_INTERNAL_EXECUTABLE F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/review-brief.ts`.
  Fresh isolated repository/worktrees and CLI-platform EdgeWorker exercised
  brief correction and approval, gap correction, and legacy guide publication.
  All three scenarios passed, with three scripted provider publications.
  Evidence: `/tmp/bobs-review-brief-f1-MVAeM3`; log
  `/tmp/ci80-brief-f1-rerun.log`.
- First F1 attempt failed because the driver assumed the context file was the
  second executable argument. The inherited binary-launch environment inserted
  a subcommand. Removing that setting for the development fixture restored its
  expected source launch; the failed attempt is retained in
  `/tmp/ci80-brief-f1.log`.
- Headless agent-browser, isolated session `ci80-merge-1010`, rendered the real
  protected Factory review with seeded tracker state and fresh verification.
  At 390×844, verified ticket before/after evidence and comment controls appeared,
  with no horizontal overflow. A scripted approval response captured the exact
  review ID, repository head and external digest sent by the shared hook.
  This is request validation, not a real human approval or provider write.

Browser fixture and receipts:
`/Users/jappy/.bobs-factory/factory/evidence/manual-974e31ba-750c-4015-8170-e3856b56c26c/ci80-brief-merge`.
Full-page screenshot capture stalled; no screenshot success is claimed.

Production tracker permissions, real-agent output and actual forge publication
were not tested by these fixtures. The existing draft PR still requires fresh
review, current-head CI and explicit human approval.
