# Test drive: factory ticket lifecycle synchronization

**Date:** 2026-10-06
**Revision:** e07cc3e56bb77922409aed9482d3fdee3824190a plus the implementation worktree diff for Taskbot #77.
**Applicability:** Required: manual issue resolution, runtime lifecycle, tracker updates and restart recovery change.
**Goal:** Keep verified originating tickets synchronized without replaying completed factory work.

**Isolated home/repository:** `/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/f1-ticket-tracking-mjkDCo`

## Executed fixture

The drive constructs a real EdgeWorker, uses its manual preparation and runtime, creates real Git worktrees from an isolated local origin, and calls a controlled Taskbot HTTPS MCP fixture through the production configured-tool client. It uses the real CLIIssueTrackerService for native team/state/link checks. Native agent roles and Git provider results are deterministic fixtures; no real PR is created or merged. The fixture resets its ticket locally for separate nested/follow-up cases. Production ticket repair evidence is recorded separately.

## Assertions and results

- [x] Real EdgeWorker manual URL setup fetched full Taskbot context through configured HTTPS MCP and moved backlog to In Progress.
- [x] Clarification, restricted implementer identity, human review and rejection/rework produced comments and one PR attachment.
- [x] Approval and simulated provider/merge queue wait did not set Done.
- [x] Restart retained confirmed merge and pending synchronization; tracking-only retry set Done without another implementation, publication or merge. Second retry duplicated neither comments nor links.
- [x] Real CLIIssueTrackerService uses its issue team, retains a started state when Review is unavailable, and stores one native PR link.
- [x] Nested workflow restricted inputs retain verified identity; a follow-up whose source is the PR inherits its parent ticket without interpreting incidental links.
- [x] Implementation summaries and check results reach ticket comments.
- [x] Taskbot comment/status mutations identify bobs-factory; PR attachment calls use the actual author-free provider schema.
- [x] HTTPS fixture closes and runtime shuts down without active agents or servers.

## Command

```bash
CYRUS_DISABLE_REMOTE_SESSION_STORE=1 NODE_EXTRA_CA_CERTS=/Users/jappy/.cyrus/factory/evidence/manual-df3a6623-c843-44af-8926-fdc200996962/ticket-f1/cert.pem \
  node /Users/jappy/.cyrus/factory/evidence/manual-df3a6623-c843-44af-8926-fdc200996962/ticket-f1/drive.mjs /Users/jappy/.cyrus/factory/evidence/manual-df3a6623-c843-44af-8926-fdc200996962/ticket-f1
```

Exit 0. Detailed provider call receipts and assertions: `/Users/jappy/.cyrus/factory/evidence/manual-df3a6623-c843-44af-8926-fdc200996962/ticket-f1/results.json`. Driver: `/Users/jappy/.cyrus/factory/evidence/manual-df3a6623-c843-44af-8926-fdc200996962/ticket-f1/drive.mjs`. No production runs were stopped or modified for validation.

## Additional regression coverage

- Reference ambiguity, quoted/example links, instance/project isolation, unsupported explicit sources, CAS conflicts, verified already-applied state and outside-run changes.
- Duplicate/ambiguous comment responses, canonical PR attachment deduplication, obsolete pending-stage coalescing, terminal ticket retention and tracking-only API protection.
- Full prompt comparison updated for the new self-describing capability; custom recipes and frozen accepted definitions retain existing runtime regression coverage.
- Latest complete EdgeWorker run: 1,154 passed, 1 skipped. Final affected runtime/pipeline/tracking tests: 94 passed. Fifteen other package suites passed; the native Linear attachment contract test also passed.

## Limits

Merge/queue outcomes and native role outputs are simulated; this drive does not assert live GitHub merging, real Linear webhook delivery or native-agent reasoning. Existing native tracker and workflow-trigger suites cover their affected boundaries. Taskbot instance binding requires a configured HTTP/SSE URL; an unidentifiable transport blocks explicitly. Providers without comment idempotency cannot guarantee exactly-once delivery. Missing native Review states and terminal-ticket ownership decisions remain visible limitations. No frontend rendering changed.

The separate production audit inventories 77 tickets, repairs 10 (six Done after live GitHub merge confirmation, four In Progress), adds eight PR links, and verifies all ten by reading them back. See the implementation evidence directory’s ticket-reconciliation.md.
