# Integration recovery failure cleanup

**Date:** 2026-10-06
**Revision:** `a9bec5faab3bab7bc0c874f60742b04c1dcb1ace` plus the failure-cleanup diff on [PR #20](https://github.com/Attraccess/bobs-factory/pull/20).

F1 applies to this session lifecycle change. This focused drive preserves the [prior integration recovery evidence](2026-10-06-integration-recovery-review-fixes.md).

## Scenario

A fresh F1 repository `/tmp/f1-cap-recovery3-59304b8c`, separate worker home ending in `-home`, and separate coordinator ending in `-pool` used RPC port 3629 and Factory port 3479. A separate Node process held the one-slot pool. The test bootstrap seeded a synthetic GitHub PR session with saved execution input and exercised the production recovery, persistence, configuration builder and capacity wrapper. Provider invocation and external replies were controlled.

```sh
apps/f1/f1 init-test-repo --path /tmp/f1-cap-recovery3-59304b8c
CYRUS_CAPACITY_DIRECTORY=/tmp/f1-cap-recovery3-59304b8c-pool \
  node <evidence-directory>/cap-recovery3-holder.mjs
CYRUS_CAPACITY_DIRECTORY=/tmp/f1-cap-recovery3-59304b8c-pool \
  CYRUS_FACTORY_PORT=3479 CYRUS_DISABLE_REMOTE_SESSION_STORE=1 \
  node <evidence-directory>/cap-recovery3-worker.mjs
CYRUS_PORT=3629 apps/f1/f1 ping
CYRUS_PORT=3629 apps/f1/f1 status
curl -X POST http://localhost:3629/test/seed
curl -X POST http://localhost:3629/test/shutdown
touch /tmp/f1-cap-recovery3-59304b8c-home/fail-config
# Restart the worker with the same isolated environment and saved state.
```

The bootstrap throws `configuration failed` from the skills resolver when the test marker exists. JSON observations came from its `/test/state` route. The scripts and observations are in the supplied evidence directory under `cap-recovery3-*` names.

## Results

- Before shutdown, the integration request was queued behind the holder, with zero provider calls.
- After restart, the configuration failure marked the saved session `error`, removed its queued request (`queued=0`), and cleared the PR reservation. The independent holder remained active (`active=1`); provider calls remained zero. The expected configuration error was logged.
- After stopping the holder, another restart retained the terminal session, with no capacity requests, configuration builds or provider invocations.
- Both isolated workers and the holder stopped cleanly. Production services and capacity state were untouched.

The first Python shutdown request used an unsupported content type and returned HTTP 415; repeating it with `curl -X POST` succeeded. This was a drive-command correction, with no product change required.

## Checks and limits

The focused integration suite passed all 15 tests. The new GitHub/GitLab regressions exercise `recoverFactoryRuns`, verify that shutdown preserves parked queue order, and verify that configuration failure removes only the failed request while preserving unrelated queued work. EdgeWorker regression coverage passed 1,153 tests, with one skipped. Lint and the EdgeWorker build passed; required full build and typecheck run through the commit hook.

This drive validates local restart and failure cleanup. It does not establish live provider inference, external GitHub/GitLab reply delivery or live tracker activity rendering. No frontend behavior changed.
