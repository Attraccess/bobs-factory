# Machine capacity review fixes

**Date:** 2026-10-06

**Revision:** `0d3317c0253413c4e3e4326234ba8cbbcf98a69e` plus this review-fix diff on PR [#20](https://github.com/Attraccess/bobs-factory/pull/20).

F1 applies to the changed setup cancellation and chat recovery paths. This is a focused follow-up to [the original drive](2026-10-06-machine-capacity.md); historical evidence is preserved.

## Isolation and assertions

A fresh F1 repository used `/tmp/f1-review-capacity-59304b8c`, state home `...-home`, coordinator `...-pool`, Factory port 3477 and CLI RPC port 3627. A separate Node process held the one-slot pool. The worker used a custom workspace handler with a GitService **without constructor capacity**, matching the production CLI path. Its setup script would touch a marker if invoked. No production service or coordinator was used.

```sh
apps/f1/f1 init-test-repo --path /tmp/f1-review-capacity-59304b8c
CYRUS_CAPACITY_DIRECTORY=/tmp/f1-review-capacity-59304b8c-pool node /tmp/fixcap-holder.mjs
CYRUS_CAPACITY_DIRECTORY=/tmp/f1-review-capacity-59304b8c-pool \
  CYRUS_FACTORY_PORT=3477 CYRUS_DISABLE_REMOTE_SESSION_STORE=1 node /tmp/fixcap-worker.mjs
CYRUS_PORT=3627 apps/f1/f1 create-issue --title 'Review preparation stop' \
  --labels primary --description '[workflow=simple] Verify cancelled setup stays cancelled.'
CYRUS_PORT=3627 apps/f1/f1 start-session --issue-id issue-2
CYRUS_PORT=3627 apps/f1/f1 stop-session --session-id session-2
CYRUS_PORT=3627 apps/f1/f1 view-session --session-id session-2 --limit 100 --offset 0
```

- **Setup stop passed:** `session-2` queued preparation at sequence 4 through the custom handler. RPC stop removed that request. The script marker was absent before and after capacity release. The launch stayed settled across restart. This drive stopped preparation during gated fetch; the regression suite additionally gates an actual setup hook and proves it runs only after admission.
- **Slack restart passed:** the F1 synthetic chat endpoint dispatched a real ChatSessionHandler/Claude runner request while the pool was full. The worker was gracefully stopped and restarted with the same home. `slack-f1-1791306162.294` rejoined sequence 2 with the same request ID and a new owner PID, unparked and still waiting for capacity. The dashboard showed Waiting for capacity. The restored session was stopped through the normal Factory API before freeing the holder; its request and title were removed.
- **Classification save passed:** agent-browser opened the built UI at 1440×1000. A controlled delay in the browser's workflows PUT held one save pending. Both classification selectors (including the second independent step) were disabled during the mutation and refresh. After release, sequential edits persisted `[true, false]` without losing the first edit. Both screenshots were inspected.

The initial unlabeled issue requested repository selection and was stopped; it does not count as setup validation. The successful setup case used the `primary` routing label.

## Evidence

- [Selectors disabled while saving](assets/2026-10-06-capacity-fixes-saving.png)
- [Both classifications saved](assets/2026-10-06-capacity-fixes-saved.png)

Bootstrap scripts, worker logs, activity output and before/after queue snapshots are copied to the supplied evidence directory under `review-fixes-*` names.

## Verification and limits

Regression coverage includes Codex lease-isolated process pooling, concurrent stale guard reclamation, actual setup hook admission, production custom-handler cancellation, GitHub/GitLab queue restoration, Slack/Zulip initial queue restoration without a native conversation, terminal stops, and remote title timeout accounting without retry. Saved reply events exclude forwarded credentials; restored replies use current platform credentials.

This drive intentionally stops queued provider work before invocation. It proves admission, persisted queue recovery and cancellation through real runtime paths, and does not claim successful live provider completion or external GitHub/GitLab/Slack/Zulip reply delivery. The original drive's provider spending and tracker-persistence limitations remain. Remote cancellation stays reserved until independently verified.

All isolated processes are stopped after validation, with an empty shared pool and no setup marker. Validation passed:

- `pnpm lint` (24 existing warnings), `pnpm typecheck`, and `pnpm build`.
- Package-wide regression execution passed the other package suites. Its initial EdgeWorker run hit two one-second polling deadlines under concurrent host load. The complete EdgeWorker rerun with `--maxWorkers=1` passed all 100 files: 1,141 tests, one skip.
- After the final chat recovery adjustment and credential restoration regression, chat/Zulip suites passed 74 tests; affected EdgeWorker typecheck/build passed again.
- A real Codex control-plane smoke launched two app-server processes under distinct machine leases. After releasing the first server and capacity lease, the second still answered `thread/list` with one active slot; final cleanup returned zero requests. No model turn was started. The initial smoke required creating its isolated `CODEX_HOME` before launch.
- WorkerService configuration forwarding passed all seven tests. Codex process pooling passed nine focused tests and 76 package tests.
- `git diff --check` passed. Repository commit hooks repeat lint-staged, build and typecheck.

The polling assertions now allow bounded coordinator/process observations to settle under concurrent host load; they retain the same behavioral expectations.
