# Specialist extraction and refinement recommendation integration

Date: 2026-10-07. PR [#32](https://github.com/Attraccess/bobs-factory/pull/32).
Tested head `9c0a28eb5408bd5898b0ab2ca58a04d6be2eaa42` merged with
main `b9974c8b121468e2075d82fd70a3ffa75d5cb757`, plus the integration fixes.

The merge preserves specialist contract validation and main's question metadata
validation, capability guidance and explicit submission requirement. A focused
regression reproduced dropped extraction recommendations before correction.
The inventory now extends the shared question schema, retaining recommendations
and validating their indices without treating them as accepted scope decisions.

F1 applies to this production finalization and question-wait boundary. The fresh
isolated drive used `F1_AGENT_MODE=mock`, injected every agent runner, retained
real bounded capacity, and exercised compiled EdgeWorker, the CLI issue tracker,
real F1 RPC, production agent output correction and the configured six-reviewer
fanout. It used dashboard/RPC ports 3923/3924 and a temporary home/repository.
No live agent or provider credits were used.

## Assertions and results

- Created DEF-1/session-1 through the F1 CLI and selected the fixture workflow
  by its configured label.
- A malformed inventory with no requirements was rejected and corrected through
  the production output boundary, without bypassing its specialist contract.
- The valid extraction retained its recommendation in saved output and pending
  questions. It had no accepted scope decisions or answers; no review round or
  aggregate existed before submission.
- A fresh named headless browser displayed the question, selected recommendation,
  rationale, separate Custom answer choice and explicit Send answers button.
  The screenshot was opened and inspected.
- Clicking Send answers recorded exactly one answer and resumed extraction.
  All six configured specialists then ran against the same frozen fixture
  revision. Executed Node assertions verified trimming and blank rejection.
  The aggregate approved exactly one met R1 assessment, with no invented scope
  decisions. The scenario ended before any PR or human review approval step.
- The named browser and isolated worker were stopped; cleanup receipts were
  retained. Historical reports and SR-001/SR-002/SR-003/QA-001 dispositions
  remain intact.

Validation passed: all 113 edge-worker test files (1,383 tests passed, one
skipped), build, typecheck, whitespace checks and Biome CI (29 existing warnings).

## Commands and evidence

```sh
pnpm --filter cyrus-edge-worker test:run
pnpm build
pnpm typecheck
pnpm biome ci
F1_AGENT_MODE=mock bun <evidence>/ci-r2/integration.mjs
```

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-0b7cf77f-8296-4e61-9df5-b03561e59729`.
The `ci-r2/` folder retains the executable fixture, CLI/browser command receipts,
waiting state, completed run/agent output/baseline assertions, snapshot,
`extraction-recommendation.png`, worker log and cleanup receipt. Root logs retain
the red regression and validation runs.

Two package-wide runs exposed asynchronous capacity initialization racing with
fixture-directory cleanup in persistence and workflow-trigger tests. The fixtures
now wait for initialization before removal; workflow-trigger cleanup also stops
capacity polling. This changes test lifecycle only. Live provider reasoning,
external tracker delivery and human approval are outside the mocked evidence.
Supplied ticket synchronization receipts are delivered.
