# Oldest workflow run gets available capacity first

Date: 2026-10-09. Taskbot ticket: #89.

Result: passed with simulated agents. This exercises the changed runtime admission
policy through issue RPC, EdgeWorker, real Git worktrees, persisted capacity and
workflow recovery. No real agent or external forge operation was used.

## Revision and reproduction

Tested the implementation worktree based on
`3e117128f77ecf256b1f7866f65906b33c83e9fb`, including the uncommitted capacity
ordering, schema, runtime metadata, teardown scope and associated tests/docs.
The fixture imports freshly built local packages.

```sh
pnpm --filter bobs-factory-core build
pnpm --filter bobs-factory-edge-worker build
F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/oldest-run-capacity.ts
```

The fixture creates a temporary local repository and Factory home, uses loopback
ports 3660/3661, and closes its worker and servers. It retains temporary receipts
for inspection. Provider calls use `f1AgentHandlers("mock")`; controlled gates
hold jobs at known points. The fixture refuses any other agent mode.

## Assertions and observed results

- Created Older before Newer through issue RPC. With one occupied slot, queued
  Newer, an interactive session, then two leaves of Older. Older's nested agent
  started first. Workflow jobs exchanged admission positions while original
  request sequence and enqueue time remained unchanged.
- Released the older agent, then admitted the interactive session in its existing
  position. Stopped and reconstructed EdgeWorker with remaining jobs parked.
  Rejoined the interactive job and checked the saved positions of Newer. The
  interactive job resumed before the older intensive script, followed by Newer.
  The completed nested agent was not repeated after restart.
- Increased available capacity for three queued workflows. Older and a newer
  workflow used two spare slots. Releasing the original blocker admitted the
  remaining newer workflow while Older continued running. No running job was
  interrupted to impose priority.
- A workflow waiting for a human answer released capacity and completed after
  the answer. Cancelling another queued workflow prevented its provider from
  starting and removed its queued work.
- Used a real WorkflowRuntime delivery coordinator with simulated forge results.
  While the first delivery waited for CI and an overlapping delivery waited its
  turn, the shared capacity pool had zero active or queued requests. Both
  deliveries completed after CI was released.
- A separate Factory home admitted work independently. Saved workflow events
  contained capacity waiting and admission messages; issue activities remained
  readable through RPC. The original pool drained before worker shutdown.

## Evidence

Run evidence is retained under
`/Users/jappy/.bobs-factory/factory/evidence/manual-f83cd8a3-1f40-428f-af42-a960b7539bbb/task89-implementation/`.

- `f1.log` and `f1/result.json`: successful command receipt and observed starts.
- `f1/before-priority.json`, `f1/exchanged.json`, `f1/before-restart.json`,
  `f1/restored-positions.json`: original request metadata and durable positions.
- `f1/spare-slots.json`, `f1/final.json`: spare-slot admission and drained pool.
- `f1/run-receipts.json`, `f1/activities.json`: workflow checkpoints and activity
  output.
- `f1/delivery-wait.json`, `f1/delivery-completed.json`: actual delivery coordination
  states around the simulated CI wait.
- `targeted-tests.log`: 187 edge-worker tests passed, including shared-process
  admission, semaphore fairness, workflow recovery and integration capacity.

Additional checks passed: six capacity schema tests, 21 CLI migration tests,
core/edge-worker type checking, core/edge-worker builds, formatting of all 17
changed TypeScript files, and `git diff --check`.

## Limits

The simulated issue tracker is in-memory. The restart scenario explicitly retains
its dataset and counters, matching the continued existence of an external
tracker; it does not test remote tracker persistence or network failures.
Forge CI and merge responses are simulated. This drive does not publish or merge
anything, validate real model output, or provide dashboard screenshot evidence.
Background starvation bounds, equal-age ordering, old state compatibility,
conflicting metadata and migration preservation are covered by targeted tests.

## Revalidation after delivery-boundary changes

Reran the fixture on 2026-10-09 after merging main
`4d0ffd783d1510edd796ec220688695e6fb17b6d` into branch head
`9a66e39b101057991448d78acaf810fc0290b5b9`, with the conflict resolution and
fixture updates uncommitted. Core and EdgeWorker were freshly built.

Main now reserves only affected repositories during concrete publication
operations. The delivery fixture supplies a simulated existing-PR receipt because
its simulated implementation produces no edits. It holds the first publication,
checks that the second delivery queues without occupying execution capacity,
then releases publication. The second delivery completes while the first waits
for CI, with zero active or queued capacity requests. All other scheduling,
recovery, cancellation and activity assertions passed with simulated agents.

The initial rerun timed out because the old fixture expected an unchanged
repository to reserve a delivery target. This was corrected in the fixture;
no production behavior was changed by the conflict resolution. The conflicting
unit test was updated to the same publication/CI boundary, preserving main's
new tests. All 283 tests across seven targeted scheduling, delivery, runtime,
tracking and pipeline suites passed.

Command: `F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/oldest-run-capacity.ts`.
Logs are retained in the run evidence directory as `ci-fix-second-f1.log`
(initial failed fixture) and `ci-fix-second-f1-corrected.log` (passing rerun).
The passing log identifies the temporary receipt directory. Real agents and
external forge operations remain untested by this drive.
