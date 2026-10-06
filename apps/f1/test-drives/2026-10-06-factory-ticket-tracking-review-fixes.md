# Test drive: review fixes for factory ticket tracking

**Date:** 2026-10-06
**Revision:** `f0ffa63722d0271060213ae38667dd636173bcab` plus the review-fix worktree diff committed with this report.
**Applicability:** Required by `f1-test-drive`: native launch preparation, runner MCP discovery, originating ticket inheritance and durable ticket-sync recovery change.
**Fixture:** Real EdgeWorker and WorkflowRuntime, real Git worktrees from an isolated local origin, real CLIIssueTrackerService, and a controlled HTTPS Taskbot MCP server called through the production configured-tool client. The default runner is Claude; accepted launches select Cursor and the repository has only `.cursor/mcp.json`.
**Isolated home:** `/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/f1-ticket-tracking-Vee2sp`

## Assertions

- [x] Real EdgeWorker manual URL setup fetched full Taskbot context through configured HTTPS MCP and moved backlog to In Progress.
- [x] Clarification, restricted implementer identity, human review and rejection/rework produced comments and one PR attachment.
- [x] Approval and simulated provider/merge queue wait did not set Done.
- [x] An offline confirmed merge receipt survives a later nonterminal milestone.
- [x] Restart retained confirmed merge and pending synchronization; tracking-only retry set Done without another implementation, publication or merge. Second retry duplicated neither comments nor links.
- [x] Real CLIIssueTrackerService uses its issue team, retains a started state when Review is unavailable, and stores one native PR link.
- [x] Nested workflow restricted inputs retain verified identity; a follow-up whose source is the PR inherits its parent ticket without interpreting incidental links.
- [x] Native URL Factory launch with a nonexistent ticket head completes from configured main; publication retains main as its base.
- [x] Follow-up without a parent PR retains native origin despite a different designated ticket in instructions; unrelated ticket remains untouched.
- [x] Native applied review status with lost response and failed reread retries without a false outside-run conflict or duplicate mutation.
- [x] Tracking-only retry reconstructs legacy confirmed-merge receipts after failed source access without replaying any workflow role.
- [x] Accepted Cursor run discovers Taskbot solely from .cursor/mcp.json while defaultRunner is Claude.

## Command and evidence

```bash
CYRUS_DISABLE_REMOTE_SESSION_STORE=1 \
NODE_EXTRA_CA_CERTS=/Users/jappy/.cyrus/factory/evidence/manual-df3a6623-c843-44af-8926-fdc200996962/ticket-f1-fixes/cert.pem \
node /Users/jappy/.cyrus/factory/evidence/manual-df3a6623-c843-44af-8926-fdc200996962/ticket-f1-fixes/drive.mjs \
  /Users/jappy/.cyrus/factory/evidence/manual-df3a6623-c843-44af-8926-fdc200996962/ticket-f1-fixes
```

Exit 0. Driver and detailed MCP call receipts: `ticket-f1-fixes/drive.mjs` and `ticket-f1-fixes/results.json` in the evidence directory above. The HTTPS fixture closed and both runtimes shut down. Production tickets and runs were untouched.

## Regression checks and limits

The six affected suites passed 146 tests across the final passing runs (101 tracking/runtime/pipeline/takeover/snapshot checks and 45 workflow-trigger checks). Workspace build and typecheck passed; changed-file Biome and diff checks passed. Regression tests also verify Takeover retains its ticket-head base behavior and real outside-run native status changes still require reassessment.

Native agent roles and Git merge/queue outcomes are deterministic fixtures. This drive verifies retained publication base metadata, not live GitHub publication or merge; the production publishing logic is unchanged. Real Linear webhook delivery and native-agent reasoning are outside this drive. No frontend changed. The earlier lifecycle and historical reconciliation evidence remains intact.
