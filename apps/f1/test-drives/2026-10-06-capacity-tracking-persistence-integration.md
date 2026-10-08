# Capacity integration with ticket tracking and responsive persistence

Date: 2026-10-06. Revisions: PR head `d07605af` merged with main `381c85c5`, plus the conflict resolutions described below. Factory web build: `1a62ec3c504fe537fca42bf4`.

This drive validates the merge on [PR #20](https://github.com/Attraccess/bobs-factory/pull/20). F1 applies because session persistence and restart recovery changed. Main's ordinary save batching is retained; transactional chat submissions remain individual writes with rollback, and form policy imports stay browser compatible. Main's ticket tracking replaces the older completion-only notification hook, and its MCP OAuth transport retains execution-lease environment for stdio descendants.

## Setup and commands

The isolated fixture uses the real EdgeWorker, ChatSessionHandler, PersistenceManager, Factory HTTP API and machine-capacity coordinator. A controlled nonstreaming provider records prompts with native conversation ID `human37-native`. No production state or process was changed.

Evidence directory: `/Users/jappy/.cyrus/factory/evidence/manual-2fbfe0ef-dbff-4400-9a37-ecf459304b8c`. The `ci37-*` fixture, drivers, home pointer and JSON observations preserve the earlier `atomic37-*` evidence unchanged. Ports: Factory 3860, F1/RPC 3861. Fresh state home: `/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/ci37-persistence-1r172i4w`; capacity coordinator uses its `-pool` sibling.

```sh
ATOMIC37_HOME=<fresh-home> CYRUS_CAPACITY_DIRECTORY=<fresh-home>-pool \
CYRUS_FACTORY_PORT=3860 CYRUS_DISABLE_REMOTE_SESSION_STORE=1 \
node <evidence>/ci37-chat-fixture.mjs
CYRUS_PORT=3861 apps/f1/f1 ping
CYRUS_PORT=3861 apps/f1/f1 start-chat-session \
  --channel C_CI37 --user U_F1 --text 'Initial merge persistence test'
python3 <evidence>/ci37-race.py
# Restart with the same isolated state and capacity paths.
python3 <evidence>/ci37-recovery.py
```

## Assertions and results

- Concurrent acceptance and storage failure passed: held the accepted input's save, submitted rejected input concurrently, released the save barrier and injected failure for the second write. HTTP responses were 202 and 409 respectively; retry returned 202. Actual disk state contained accepted and retried input and excluded rejected input. See `ci37-before-restart.json`.
- Restart passed: exactly one initial turn, then accepted input and retried input executed in order, resuming the saved native conversation. Rejected input never executed. Final pending messages and queued-message IDs were empty; active and queued capacity both reached zero. See `ci37-restored.json` and `ci37-delivered.json`.
- Browser verification passed against the rebuilt assets: Recipes renders the shared default-four capacity panel and classification controls. Its passive handoff options remain disabled for intensive classification. See [Recipes screenshot](media/2026-10-06-capacity-tracking-persistence-integration/recipes.png).
- Mobile chat verification passed at 393×852: after two additional HTTP submissions returned 202, the queued message displayed its badge and the populated composer kept Send enabled. See [mobile screenshot](media/2026-10-06-capacity-tracking-persistence-integration/chat-mobile.png). Stopping the session removed pending message IDs and drained active/queued capacity. See `ci37-browser-stop.json`.
- All isolated workers and the browser session were stopped.

## Regression checks and limits

Core suite: 201 tests passed. Focused MCP transport suite: five tests passed, including OAuth permissions and stdio execution provenance. New persistence regressions retain batched lifecycle saves around a transactional barrier and verify rollback before subsequent snapshots. Final edge-worker suite: 1,309 tests passed, one skipped, across 108 files. Full build and typecheck passed; lint passed with 28 existing warnings. Required commit-hook results are recorded in the role receipt.

The first browser build exposed a Node-only ticket import through the form's capacity-policy dependency; moving that policy to a browser-safe module fixed the build. Initial parallel tests exceeded one-second asynchronous completion/cleanup expectations, which now allow ten seconds while preserving every state assertion. A new MCP test initially assumed an unwrapped command; its assertion now checks retained configuration and lease environment through the existing workspace wrapper. Early browser navigation preceded fixture readiness; screenshots above were captured after successful startup.

This controlled-provider drive verifies HTTP acceptance, persistence, continuation, rendering, cancellation and restart. Live model inference and external Slack/Zulip reply delivery remain unverified. Existing ticket-sync receipts report delivered lifecycle updates; no tracker lifecycle mutations were performed manually in this role.
