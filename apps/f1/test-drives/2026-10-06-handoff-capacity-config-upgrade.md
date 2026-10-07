# Saved handoff classification restart recovery

Date: 2026-10-06. Candidate: `cdfe324e` plus the migration committed with this report.

F1 applies because the change restores worker startup and saved run recovery.
An isolated CLI EdgeWorker used a fresh Git repository, home and limit-one
coordinator on RPC port 3711. A temporary `gh` executable simulated UNKNOWN,
then MERGEABLE readiness; the real runtime, command execution, tracker and
handoff formatter ran. Production workers and capacity settings were untouched.

## Assertions and results

- Persisted both a stock pipeline and a custom recipe with the formerly valid
  `handoff.computeIntensive: true`, selecting the custom recipe as the default.
- Saved a running custom workflow at handoff with a completed preparation receipt,
  an accepted intensive handoff snapshot and accepted workflow definitions.
  Its completed preparation script would exit 97 if incorrectly replayed.
- Restarted the EdgeWorker. Startup succeeded; both saved recipe flags became
  false and the selected default survived. The accepted run and dependency
  definitions remained equal to their original snapshots.
- Waited for an actual UNKNOWN-readiness activity. Handoff showed `waiting-ci`,
  with active, stopping and queued counts all zero. An independent intensive
  script completed through the same runtime while handoff continued polling.
- F1 `ping` and `status` passed through the worker's CLI RPC endpoint.
- Switched simulated GitHub readiness to MERGEABLE. Recovery completed handoff,
  posted exactly one tracker comment, retained the completed preparation receipt
  exactly once and recorded recovery, readiness and completion events.
- Restarted again. The normalized recipe file was byte-identical; the completed
  run and its original definitions remained intact. All workers stopped cleanly.

The first fixture synchronously invoked F1 against its own server and was changed
to asynchronous RPC calls. The CLI tracker stores tickets in memory, so the fixture
restored its ticket after restart. A further fixture correction waited for the
actual readiness activity before changing readiness, ensuring polling was exercised.
The corrected drive passed from a fresh home; earlier fixture logs remain in evidence.

## Checks and evidence

111 focused tests passed across WorkflowRuntime, FactoryPipeline and MachineCapacity.
Regression tests cover both saved configuration formats, nested custom fanout,
stock handoff migration, default preservation, unaffected intensive tools,
immutable accepted snapshots and idempotent normalization. Existing tests still
reject newly submitted intensive handoff classifications and validate passive
accepted snapshots. Lint passed with 24 existing warnings; commit hooks run the
full build and typecheck.

```sh
pnpm --filter cyrus-edge-worker test:run test/WorkflowRuntime.test.ts test/FactoryPipeline.test.ts test/MachineCapacity.test.ts
pnpm --filter cyrus-edge-worker build
pnpm lint
F1_EVIDENCE=<evidence-directory> node <evidence-directory>/handoff-upgrade-fixture.mjs
```

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-2fbfe0ef-dbff-4400-9a37-ecf459304b8c`.
The fixture, `handoff-upgrade-drive.log`, recovered/completed JSON snapshots and
F1 ping/status logs are retained there. Historical drives and screenshots are
preserved. This backend-only migration changes no rendered UI; live GitHub and
external provider execution remain outside this isolated validation.
