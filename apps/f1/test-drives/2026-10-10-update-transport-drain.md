# Updater transport admission and descendant drain — mocked F1

Date: October 10, 2026. Tested production/test source:
`9717247b5429516ad0fa27f36d267c25ec8e57dc`, draft
[PR #86](https://github.com/jappyjan/bobs-factory/pull/86).
Addresses the confirmed P1 in [Taskbot #116 comment #1020](https://taskbot.apps.janjaap.de/p/bobs-factory/t/116).
The original [safety corrections](2026-10-10-update-safety-corrections.md) and
[initial drive](2026-10-10-update-lifecycle.md) remain historical evidence.
#119/#120 remain in progress.

## Reproduction and correction

Independently ran both retained review reproducers before editing at
`8be327b3f8d8e1b1966f33f14be424ebf2ce98eb`:
`/tmp/delivery-updater-inspect-worker-round2.mjs` and
`/tmp/delivery-updater-inspect-process-round2.mjs`.
The actual started worker, OperatorServer, production check hook and MachineCapacity
allowed a configured Node stdio MCP child to execute tools/list after maintenance
freeze and while an already admitted check crossed freeze. Drain reported idle
with zero active/stopping/queued capacity. Only configuration/credential resolution
was controlled; no provider or external network was used.

Operator admission now follows runtime effects instead of authorization scope.
Live checks and MCP configuration inspection enter accepted-operation accounting
before their first await and refuse new admission during maintenance. `list_runs`,
`read_run_activity`, and the stored-state portion of `inspect_run` remain available.
Frozen `inspect_run` returns a maintenance diagnostic instead of calling its MCP
hook. The hook normally builds runner configuration, resolves/materializes execution
credentials and diagnostics, so it is guarded and counted outside maintenance too.

The worker holds a durable MachineCapacity lease around operator preparation/checks
and dashboard transport tests. Shared configured transport requests also obtain a
lease when outside an existing role scope. Nested requests reuse the current role's
token, preserving necessary callbacks while work drains without taking a second
slot. Stdio descendants receive that token; release verifies their termination
before deleting capacity ownership. Error/abort paths retain and await the original
close promise in the direct and Codex clients, including an explicit direct transport
close after connection failure. One admitted check signal covers queueing,
preparation and the direct/native transport request; expired preparation cannot
start a fresh check. Existing capacity reconciliation fences surviving
descendants after owner death. No updater lock/channel/release contract changed.

## Exact-source F1 results

F1 applies to this runtime admission/lifecycle change. Both drives passed after the
source commit and required build/typecheck. Commands:

```sh
F1_AGENT_MODE=mock \
F1_TESTED_COMMIT=9717247b5429516ad0fa27f36d267c25ec8e57dc \
F1_EVIDENCE_DIR=/tmp/delivery-updater-transport-f1-final \
node apps/f1/test-drives/assets/update-maintenance.mjs
F1_AGENT_MODE=mock \
F1_TESTED_COMMIT=9717247b5429516ad0fa27f36d267c25ec8e57dc \
F1_EVIDENCE_DIR=/tmp/delivery-updater-transport-f1-final \
node apps/f1/test-drives/assets/update-lifecycle.mjs
```

[Actual-worker receipt](assets/2026-10-10-update-transport-drain/update-maintenance.json):
nine scenarios pass. The expanded production-path assertions establish:

- Before freeze, a check awaits controlled configuration while already counted and
  holding one executing durable capacity request. Drain stays non-idle.
- Its real stdio child then performs tools/list during drain with exactly that
  request's token. Request identity, owner PID/start/incarnation, token and child PID
  are retained in the receipt. Capacity remains active and drain remains non-idle.
- Releasing the server produces natural stdin-close exit. The check does not return
  until the child has exited and its capacity record is removed; only then is idle
  acknowledged. No signal is used to finish this admitted check.
- New checks/configuration inspection refuse before preparation or spawn, both
  during busy drain and after the final idle capacity barrier. Stored inspection
  stays available without calling configuration hooks.
- The authenticated dashboard test route has the same durable descendant ownership
  through natural exit and rejects a second request during maintenance.
- A callback from an already active role remains available during maintenance,
  uses that role's exact token, and does not acquire a second capacity slot. Drain
  remains non-idle until the original role releases.
- Existing reboot receipt/preflight, seven operator mutations, exact release resume,
  accepted operator write, and accepted ticket preflight assertions still pass.

[Replacement receipt](assets/2026-10-10-update-transport-drain/update-lifecycle.json):
all seven existing controlled replacement/rollback/preservation scenarios pass;
peak controlled runtime count is one. Waiting gates, accepted definitions and mock
native checkpoint/session identity are preserved. This is the existing in-process
lifecycle fixture, not OwnedUpdateLifecycle or an OS service restart.

## Targeted checks

215 unit/integration tests pass: 172 across the nine prior updater/runtime suites,
12 factory MCP OAuth tests, nine direct client tests, seven Codex MCP client tests,
three ConfigUpdater tests, and 12 connection-discovery/operator integration tests.
Five canonical release-discovery tests also pass. Required monorepo build and
typecheck, changed-file Biome, and `git diff --check` pass. No dependencies changed.

New regressions cover all three live inspection entry points across an awaited
preparation/freeze boundary, single-slot nested transport ownership, initialization
cancellation, catalog cancellation/timeout/error, and real delayed natural closure.
A controlled process is actually SIGKILLed while a real stdio MCP server retains
its lease token. Production capacity reconciliation terminates the surviving child
before admitting another lease. This tests coordinator crash cleanup, not native
agent conversation continuation or owner-specific updater recovery.

One initial crash-test attempt timed out because the fixture waited for `close`
before reconciliation, while the orphan retained its owner's stderr pipe. The
fixture now waits for owner `exit`, reconciles the descendant, then awaits `close`.
The controlled leftover was terminated and the corrected 17-test capacity suite
and complete 172-test selection passed. No F1 assertion failed during the fix.

## Limits and remaining acceptance

The expanded drive uses an actual EdgeWorker.start, worker-owned OperatorServer,
UpdateDrain, MachineCapacity and production direct MCP transport, with isolated HOME
and synthetic grants/session/configuration. Tracker fetching/final routing and
configuration/credential resolution are controlled. No external provider/network,
production homes/services, real-agent credits, private keys, signing, publication,
merge or ticket closure occurred. No service/desktop/packaging source was edited.

PR85 must consume the exact source checkpoint and preserve the additive
`transaction.release` pending/acknowledged contract, exact idempotent release and
healthy-activation recovery without repeated rollback. Actual scheduled supervisor,
OwnedUpdateLifecycle suppression/single replacement/bounded health/rollback,
successful signed discovery/download/extraction, PR84 install/settings handoff,
real native-session and auth/native-store preservation, final four-target payload
and shipped desktop/service native receipts remain open. The new desktop native
workflow's default-branch workflow_dispatch 404 is not native validation evidence.
Authentic reviewed publisher pins, protected signing, eligible complete public
channels and exact publication/stable approval remain #117 prerequisites.
Independent review of the corrected source remains required; this report does not
close #119/#120 or epic #116.
