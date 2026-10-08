# Specialist review and feedback-recovery integration

Date: 2026-10-07. PR [#32](https://github.com/Attraccess/bobs-factory/pull/32).
Tested working tree based on `351f2550c7c3cfc974909f91ce4a4cdda188ace3`, merged
with main `ce61ddb6386440e5bbdcbd102890509e81b5d35f`, plus the recovery integration.

## Applicability and scope

F1 applies to the merged Factory review lifecycle and feedback gates. Conflict
resolutions preserve specialist baselines, review attribution, chat isolation,
refinement recommendations, durable assistance batches, and main's feedback
assessment/recovery safeguards. The specialist aggregate now applies the same
unchanged-fix recovery guard as general review. Fixer provenance and the
runtime-owned finding context use the configured aggregate's frozen revision
and namespaced findings, including renamed gates.

## Executed assertions

The specialist fixture used the real compiled CLI EdgeWorker, F1 RPC, production
agent-output correction, bounded capacity and six stock specialist steps. All
runners were injected deterministic mocks with `F1_AGENT_MODE=mock`. An isolated
home and Git repository ran on ports 3923/3924.

- Malformed extraction was corrected inside the existing role; valid extraction
  retained recommendations without recording accepted decisions or answers.
- A fresh named headless browser displayed the recommendation and explicit Send
  answers button. The screenshot was opened and inspected. Submission resumed
  extraction and launched six reviewers sharing one clean frozen revision.
- The security reviewer reported a namespaced consequential external-validation
  finding. The fixer rejected it without changing the revision. All specialists
  reassessed it once, then the aggregate parked the run with the finding still
  blocking. Exactly one fixer had run; its runtime receipt recorded unchanged
  code against the aggregate baseline.
- An explicit assistance answer resumed the existing fixer. Fresh extraction and
  six reviewers completed; the finding became resolved and complete R1 coverage
  approved. Exactly two fixers ran. This fixture ended before PR/human approval.
- The browser and worker stopped cleanly.

The four legacy review-recovery fixtures also passed: same-role correction of
missing dispositions with restricted inputs, unchanged rejection with restart,
real source correction requiring fresh review, and visual-fixer assistance.
They retained findings while waiting, resumed only after answers, and freed all
capacity. No human approval was invented.

The six feedback fixtures passed persistent explicit ignore, exact-comment output
correction, no-progress wait/restart, fresh review after code change, policy
reversal, and restricted recipe inputs. Final capacity was zero active/queued;
all workers stopped cleanly. Provider receipts were scripted.

## Verification and evidence

- All 115 EdgeWorker test files passed: 1,429 tests passed, one skipped.
- Build, typecheck, Biome CI and whitespace checks passed. Biome retained 29
  existing warnings.
- The first broad run exposed the new regression's default one-second wait under
  suite load. Its wait now allows ten seconds and always stops/awaits the runtime
  before cleanup; the final full suite passed without unhandled errors.

Commands:

```sh
pnpm --filter cyrus-edge-worker test:run
pnpm build
pnpm typecheck
pnpm biome ci
F1_AGENT_MODE=mock bun <evidence>/ci-r3/specialist-recovery.mjs
F1_AGENT_MODE=mock bun <evidence>/ci-r3/factory-review-recovery-drive.ts
F1_AGENT_MODE=mock bun <evidence>/ci-r3/factory-feedback-drive.ts
```

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-0b7cf77f-8296-4e61-9df5-b03561e59729/ci-r3`.
It retains the executable fixtures, saved wait/run/context/receipt data,
headless screenshot, command receipts, and cleanup evidence. Validation logs
are retained there as well. Historical evidence and SR-001 through SR-004 and
QA-001 dispositions remain intact.

Agents and provider boundaries were mocked. These checks establish orchestration
and persistence, not live-provider interpretation or external tracker delivery.
The supplied ticket-sync receipts are delivered; the historical recovered
capacity-lock incident remains a limitation. No PR readiness change or merge
was performed.
