# Test drive: quiet restart recovery for closed tickets

**Date:** 2026-10-06
**Revision:** `6bab417c` plus the working diff for closed-ticket recovery.
**Applicability:** Required: Factory startup recovery and issue-tracker delivery change.
**Fixture:** Real EdgeWorker start/stop, persisted WorkflowRuntime JSON, real
CLIIssueTrackerService and native ticket adapter, HTTP F1 RPC, and an isolated
Git repository. Three fresh worker instances share the fixture ticket provider
and load the same saved home.
**Home:** `/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/f1-closed-ticket-recovery-rehMth`
**RPC port:** `58461`

## Assertions and results

- [x] Three startup/shutdown cycles return `pong` through `/cli/rpc`.
- [x] Historical failed, stopped, completed and interrupted attempts on a Done
  ticket create no recovery comments or new synchronization receipts.
- [x] Pending stale stage and outcome receipts on Done/canceled tickets become
  durably superseded, with no comments, status changes or PR attachments.
- [x] A genuine pending progress receipt on an open ticket is delivered once.
- [x] A pending confirmed merge sets Done, posts one receipt and attaches one PR.
- [x] An active legacy run resumes its real script step once and completes.
- [x] Ticket statuses, complete comment bodies and attachments are identical
  after the second and third starts; completed script history is not replayed.
- [x] Every fixture worker shuts down and its HTTP server closes.

## Command and evidence

```bash
CYRUS_DISABLE_REMOTE_SESSION_STORE=1 CYRUS_FACTORY_PORT=0 WEBHOOK_IP_VALIDATION=false \
  node /tmp/f1-closed-ticket-recovery-evidence/drive.mjs \
  /Users/jappy/.t3/worktrees/bobs-factory/t3-24b921a8 \
  /tmp/f1-closed-ticket-recovery-evidence
```

Exit 0; `results.json` and `drive.log` in that evidence directory retain the
assertions and all three ticket snapshots. Production Bob and Linear tickets
were not changed.

## Regression checks and limits

The initial regression run reproduced seven failures, including the unwanted
comments on closed tickets. After the fix, the tracking, workflow-trigger,
pipeline, runtime and merge-recovery suites passed all 176 tests. Workspace
build/typecheck and changed-file Biome checks passed.

This drive tests production startup recovery with saved fixtures. Its native
tracker is the F1 CLI provider; real Linear delivery is not exercised. The merge
receipt is seeded provider evidence; no GitHub PR is created or merged. Taskbot
terminal-state and restart behavior is covered separately by the tracking suite.
