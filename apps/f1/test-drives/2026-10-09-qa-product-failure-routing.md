# Recorded QA failures reach correction

Date: 2026-10-09. Tested `be36eb34` plus the routing, review instructions and
regression changes. SHA-256 of that four-file diff:
`8832aa7f2aa4522f8918f2a23c9c350e83269c3f9e09364523e3bb17145013c0`.

## Applicability and setup

F1 applies because the change affects Factory review and recovery lifecycle.
A real CLI-platform EdgeWorker listened on RPC 3600 with a disposable repository,
home and capacity pool. All provider and title runners used MockAgentRunner;
no native agent CLI or inference API was invoked. A custom workflow exercised
clarification, QA scope, capture, visual review, the real visual gate and fixer.
Each scenario began through F1's `createIssue` and `startSession` JSON-RPC methods.

## Results

- Recorded failed behavior, followed by a reviewer returning `status:failed`,
  reached the fixer without an assistance question. One scripted fixture repair
  committed a new revision; fresh capture and completed review passed the gate.
  There were two captures, two reviews, one fixer and no human answers.
- Passing QA with a reviewer blocked by an unavailable diff waited at the gate
  with `reviewIncomplete:true`. It never approved or invoked a fixer. The fixture
  was explicitly stopped during cleanup.
- A saved wait produced by the previous gate interpretation survived runtime
  shutdown. Reloading WorkflowRuntime from disk with the corrected gate reached
  the fixer and completed fresh QA/review without a human answer. Clarification
  and QA scope each executed once; earlier work was retained. The EdgeWorker,
  issue tracker and activity sink stayed alive during this runtime replacement.
- Every scenario exposed response activities through `viewSession`. The worker
  stopped and freed port 3600. The repository intentionally had no remote, so
  worktree setup logged the expected fetch warning and used local `main`.

Driver: `/tmp/bobs-factory-qa-routing-f1.ts`. Command:
`F1_AGENT_MODE=mock bun run /tmp/bobs-factory-qa-routing-f1.ts`.
Final log: `/tmp/bobs-factory-qa-routing-f1-final.log`.
Receipts and run state:
`/var/folders/_r/fld8l71j7ts635hlb5vtgnb80000gn/T/qa-product-routing-f1-J3MFdx`.
The initial fixture omitted required stock workflows; setup was corrected before
the passing drives.

## Other verification and limits

- The new focused regression failed before the fix for both failed and blocked
  reviewer statuses. All 192 FactoryPipeline, FactoryProvenance, WorkflowRuntime
  and ReviewRecovery tests passed after building the required dashboard assets.
- EdgeWorker build, typecheck, targeted Biome checks and `git diff --check` passed.
- Read-only evaluation of run `68134ef0-a54b-4a74-812b-a00972bd98bc` retained its
  open profiling findings and removed the erroneous reviewer assistance route.
  No live run state, answer, approval or installed binary was modified.

This validates mocked orchestration and saved-state interpretation. It does not
establish a fix for the underlying Pyroscope behavior, native model reasoning,
human approval or deployment of the corrected runtime.
