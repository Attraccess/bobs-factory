# Integration recovery review fixes

**Date:** 2026-10-06
**Revision:** `e2f53e3096a3fbeda752853958f1b3fdbcbe4067` plus this recovery-fix diff on [PR #20](https://github.com/Attraccess/bobs-factory/pull/20).

F1 applies to the changed integration session lifecycle. This focused follow-up preserves the [previous capacity evidence](2026-10-06-machine-capacity-review-fixes.md).

## Scenario and isolation

A fresh F1 repository at `/tmp/f1-cap-recovery2-59304b8c`, a separate worker home ending in `-home`, and coordinator ending in `-pool` used CLI RPC port 3628 and Factory port 3478. A separate Node process held the one-slot pool. The worker enabled the real sandbox egress proxy on ephemeral ports and used Claude as its current default.

A test-only bootstrap seeded a synthetic GitHub PR session with saved Cursor/model/input/reply context, then exercised the production configuration builder, capacity wrapper, persistence, startup recovery, GitHub webhook handler, and Factory stop API. Provider invocation and external reply delivery were controlled to avoid model spending or posting to another user. Configuration loading was held behind a barrier during restart.

```sh
apps/f1/f1 init-test-repo --path /tmp/f1-cap-recovery2-59304b8c
CYRUS_CAPACITY_DIRECTORY=/tmp/f1-cap-recovery2-59304b8c-pool \
  node /tmp/cap-recovery2-holder.mjs
CYRUS_CAPACITY_DIRECTORY=/tmp/f1-cap-recovery2-59304b8c-pool \
  CYRUS_FACTORY_PORT=3478 CYRUS_DISABLE_REMOTE_SESSION_STORE=1 \
  node /tmp/cap-recovery2-worker.mjs
CYRUS_PORT=3628 apps/f1/f1 ping
CYRUS_PORT=3628 apps/f1/f1 status
```

The bootstrap's `/test/seed`, `/test/state`, `/test/webhook`, `/test/unblock`, and `/test/shutdown` routes supplied controlled inputs and observations. User stop went through `POST /api/runs/github-recovery-test/stop` with the required `X-Factory-Request: 1` header. Initial requests without that header were rejected by the existing local API guard.

## Assertions and results

- **Saved provider configuration passed:** before admission and after restart, the configuration builder selected Cursor with `saved-cursor-model`, enabled sandbox settings, real ephemeral proxy ports and the isolated CA path despite the current Claude default. No native conversation ID existed.
- **PR serialization passed:** the restored PR reservation existed before configuration loading completed. A same-PR webhook queued without reaching workspace creation. After recovery cancellation, the queue advanced and the reservation cleared. The synthetic next event stopped at the missing remote PR metadata guard; it did not execute another workload.
- **Stop during configuration passed:** the normal Factory stop API removed the saved parked capacity request while the configuration barrier remained blocked. After unblocking, the stopped provider was never created or invoked and its session remained `error`.
- **Terminal restart passed:** after stopping both isolated processes and freeing capacity, another worker restart preserved the terminal stop. There were zero pool requests, no recovery configurations, no PR reservations and no provider invocations.
- **Cleanup passed:** all isolated worker/holder processes stopped. Production services and coordinator state were untouched.

Bootstrap scripts, logs, and before/restart/stop/cleanup JSON observations are copied to the supplied evidence directory under `cap-recovery2-*` names.

## Checks and limits

Focused regression coverage passed 13 tests, including GitHub/GitLab Cursor sandbox restoration, native conversation and queue-order preservation, terminal-state rechecks, immediate parked-queue cancellation, and GitHub queue advancement on completion, failure and terminal result. The EdgeWorker suite, lint, build and typecheck validate the affected implementation; final results are recorded with the fixer disposition.

This drive validates persisted integration recovery through an isolated F1 worker and real local APIs. It does not establish successful live Cursor inference, external GitHub/GitLab reply delivery, or live issue-tracker activity rendering. Those prior limitations remain. No frontend behavior changed in this follow-up.
