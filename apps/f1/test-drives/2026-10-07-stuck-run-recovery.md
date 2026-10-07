# Stuck workflow recovery

Date: 2026-10-07. Tested the working tree based on `981c3155` with the recovery
changes. Evidence: `/tmp/bobs-recovery-f1-Oxl6AS`; driver:
`/tmp/bobs-recovery-drive.ts`.

## Applicability and scenarios

F1 applies to Factory runner and workflow lifecycle changes. A real CLI-platform
EdgeWorker used a fresh repository, one-slot capacity pool, RPC 3600 and UI 3540.
Every agent provider was replaced with a deterministic MockAgentRunner. No agent
CLI or inference API was invoked. Fixtures ignored harness instruction files to
keep provenance clean. The external in-memory issue tracker and activity sink
were retained across worker replacement, modelling a persistent tracker.

The four scenarios began through `apps/f1/f1 create-issue` and `start-session`:

- A failed criterion and a finding with an invalid extra requirement reference
  reached the existing visual fixer, then fresh capture and review. The gate
  approved the repaired fixture; no human answer or approval was invented.
- Missing criterion results automatically repeated capture and review once.
  Fresh complete evidence passed without requesting human input.
- A mock Codex turn emitted the real inactivity error shape. The role resumed
  the same conversation once and returned the fixture result. All result costs
  remained zero.
- A genuinely blocked account fixture waited for assistance. The worker shut
  down and was replaced using the same home; the saved gate recovered its wait.
  Answering through `/api/runs/:id/answer` repeated capture/review and completed.

`receipts.json` records all four completed runs, their exact history and role
counts. The corresponding run JSON files retain coherent runner/workflow events,
provenance and gate outputs. The final pool had zero active and queued requests.
The worker shut down cleanly and both ports were freed. The successful drive had
no error logs or unhandled exceptions.

A supplemental fresh drive of the final changes based on `0d8e866f`, using
`/tmp/bobs-recovery-six-drive.ts`, passed all six scenarios. Evidence is retained
at `/tmp/bobs-recovery-f1-UaAIiV`. It repeated the four cases above and added:

- Stale CI at handoff routed through the configured fixer and a fresh code review.
- An unchanged failing CI job, alongside a pending human reviewer approval,
  waited for assistance. An API answer resumed the existing fixer and completed
  once the fixture check succeeded. Human approval did not trigger agent review.

The first supplemental attempt exposed the pending-human-review classification
bug; it was fixed before the successful drive. Both supplemental runs used only
mocked agents and provider receipts, with zero inference costs.

## Other verification

- 213 targeted tests passed for Factory gates/restart, runner output correction,
  bounded inactivity recovery, merge readiness, instance capacity and the API.
- `pnpm -r test:run`: 2,607 passed tests across 208 files.
- After the supplemental fix, all 1,340 EdgeWorker tests passed (one skipped),
  including required-review versus missing-human-approval regression cases.
- `pnpm typecheck`, `pnpm build`, `pnpm biome ci` and `git diff --check` passed.
  Biome retained 29 existing warnings.
- Handoff tests cover current provider conflicts and stale saved CI revisions,
  routing through the configured fixer while retaining head/review safeguards.
- CI tests distinguish an unchanged failed check from a newly executed check,
  and verify assistance resumes the existing fixer without replaying implementation.

Exploratory fixtures first exposed setup errors: an incorrect ping-output
assertion, polling before asynchronous run creation, unignored `.claude` files,
and replacing the external in-memory tracker. Those fixtures were stopped;
final evidence comes from the corrected fresh drive above.

This is mocked orchestration evidence. It does not prove native model behaviour,
real device push delivery, or successful completion of the production features.
