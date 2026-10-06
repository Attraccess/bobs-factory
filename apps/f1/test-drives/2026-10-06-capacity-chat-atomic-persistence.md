# Capacity chat: atomic concurrent input persistence

Date: 2026-10-06. Tested revision: `cc97e3e929e88570d0a320188af153b298d9fe71` plus this finding fix. Factory web build: `f996ee4f98ccb9f5b771d716` (unchanged).

This drive addresses `capacity-chat-rejected-message-recovery` on [PR #20](https://github.com/Attraccess/bobs-factory/pull/20). Session persistence and restart recovery make F1 applicable. Queue submission remains available during capacity waits.

## Setup and commands

Used a real isolated EdgeWorker, ChatSessionHandler, PersistenceManager, Factory HTTP API and machine-capacity coordinator. The controlled nonstreaming provider records prompts and preserves native conversation ID `human37-native`. No production process or state was changed.

- State root: `/tmp/atomic37-mzMYMJ`; coordinator: `/tmp/atomic37-mzMYMJ-pool`.
- Factory UI/API: port 3860; F1/RPC: port 3861; isolated capacity holder: port 3862.
- Fixture sources, driver scripts and JSON observations: `/Users/jappy/.cyrus/factory/evidence/manual-2fbfe0ef-dbff-4400-9a37-ecf459304b8c/atomic37-*`.

```sh
ATOMIC37_HOME=/tmp/atomic37-mzMYMJ \
CYRUS_CAPACITY_DIRECTORY=/tmp/atomic37-mzMYMJ-pool \
CYRUS_FACTORY_PORT=3860 CYRUS_DISABLE_REMOTE_SESSION_STORE=1 \
node <evidence>/atomic37-chat-fixture.mjs

CYRUS_PORT=3861 apps/f1/f1 ping
CYRUS_PORT=3861 apps/f1/f1 start-chat-session \
  --channel C_ATOMIC37 --user U_F1 --text 'Initial atomic chat test'

python3 <evidence>/atomic37-race.py
# Restart the isolated fixture with the same home/coordinator.
python3 <evidence>/atomic37-recovery.py
```

The HTTP driver sends the required `x-factory-request: 1` header. Its first attempt omitted that header and was correctly rejected before reaching the save barrier; the corrected drive below passed. The separate capacity holder's lease was released before the initial turn. Asynchronous continuation setup was blocked to retain accepted inputs until restart.

## Assertions and results

1. **Concurrent save failure — passed.** Held the accepted input's save before the real persistence manager serialized it. Submitted a second input concurrently, released the barrier, and injected a storage failure for that second input. The first HTTP request returned 202; the second returned 409 with `Controlled disk full`.
2. **Durability and retry — passed.** Retried with a new input; it returned 202. Inspected the actual saved `edge-worker-state.json`: accepted and retried instructions were present, rejected instructions were absent. The provider still had only the initial start. Evidence: `atomic37-before-restart.json`.
3. **Restart and ordered delivery — passed.** Shut down and restarted the worker with the same state home. Start two received `Accepted concurrent input`; after completion, start three received `Retried input after disk failure`. Both resumed `human37-native`. The initial completed prompt and rejected input were never replayed. Evidence: `atomic37-restored.json`, `atomic37-delivered.json`.
4. **Completion and cleanup — passed.** After both accepted turns completed, active and queued capacity counts were zero, pending message storage was empty and queued message IDs cleared. Exactly three provider starts occurred, including the initial turn. Both isolated worker instances and the capacity holder were stopped.

## Automated validation and limits

The focused continuation, Slack/Zulip session integration and Factory API suites passed all 31 tests. The regression reads the first successful disk snapshot as well as the final state, so a later lifecycle save cannot hide a transient rejected-message recovery window. It also checks lifecycle saves, retry and recovery into a fresh handler. Running the same regression against the original implementation failed because the first disk snapshot contained both accepted and rejected inputs; the fixed implementation passed. Lint passed with 28 existing warnings; edge-worker build passed. Required repository commit-hook build/typecheck results are recorded in the role result.

This controlled-provider drive verifies real HTTP acceptance, disk persistence, continuation and restart. Live model inference and external Slack/Zulip reply delivery remain unverified. No frontend assets changed; existing visual evidence for enabled Send and queued-message badges remains applicable.
