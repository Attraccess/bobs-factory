# Refinement recommendations: QA follow-up

Date: 2026-10-07. Product revision: `41cbc463ead412e39e40a1172378548e9d6ca58f`.
Dashboard build: `43bb8d9ef49f509a12e2082e`. Draft PR: [#31](https://github.com/Attraccess/bobs-factory/pull/31).
This supplements the original report; it does not replace historical evidence.

## Finding and execution constraints

`qa-native-f1-capacity` reports four blocked native-agent criteria. The current
factory role instructions require `F1_AGENT_MODE=mock`, explicit mocked runners
in older embedded harnesses, and explicit authorization before spending provider
credits. No such authorization is present in the supplied answers or decisions.
Changing the production capacity limit would not resolve that authorization gap.

The new fixture injects only the runner at `buildRunnerForType`; it does **not**
replace `WorkflowRuntime.hooks.agent` or `executeFactoryAgent`. It uses the real
CLI issue/session RPC, worktree preparation, factory-context snapshot, additive
question instructions, result validation, persisted question wait, HTTP answer
handler, prompted-session webhook, continuation and receipt script. Mock output
is canned and cannot establish model reasoning or native-provider compatibility.
The older embedded server does not interpret `F1_AGENT_MODE`, so the fixture
asserts that mode and explicitly replaces every runner construction it uses.

A temporary capacity directory retains real bounded admission without touching
the production pool. All fixture work runs sequentially; no live agent or harness
subagent is launched. Ports 3623 and 3543 must be available. Fixture state and its
fresh local repository remain under a generated temporary directory for inspection.

## Reproduction

From the repository root, build `cyrus-edge-worker` and `cyrus-f1`, then run:

```sh
F1_AGENT_MODE=mock F1_EVIDENCE_DIR=/absolute/evidence/directory \
  node apps/f1/test-drives/assets/refinement-recommendations-mock.mjs
```

The script executes F1 `ping`, `create-issue`, `start-session`, `view-session`
and `prompt-session`. It starts a fresh named **headless** agent-browser session,
reads its accessibility snapshot, captures the default selection, clicks its
observed Send answers button, and closes only that session. Servers stop in
`finally`; unfinished fixture runs are stopped without changing unrelated runs.

## Results

- Both recommendation indices, answers and reasons survived the actual agent
  execution/validation path into each saved question wait. Before human action,
  answers were empty and no receipt existed.
- Dashboard: both recommendation radios were selected. One real Send answers
  click stored the exact numbered Q&A containing Email and Daily digest. One
  continuation received that Q&A through factory-context; one receipt completed.
- Existing session: F1 `prompt-session` sent `Use Email and Daily digest.` to
  session-2. The exact text became its sole accepted answer. One continuation
  received it and one receipt completed; no replacement issue/session was created.
- CLI fixture notifications labeled Suggested answer and Why and required an
  explicit reply or dashboard submission. This is fixture delivery evidence.
- Inspected the 1280×1100 screenshot: both recommendations, reasons, custom
  choices and Send answers are readable. No frontend code changed in this role.
- Targeted Questions, WorkflowRuntime, FactoryServer and EdgeWorker output
  correction suites passed: **106 tests**. Edge-worker build passed. Fixture
  syntax, Biome and diff checks passed.

Raw receipts, calls, context snapshots and commands are in `qa83-mock-path.json`
and `qa83-mock-commands.json`; the execution log is `qa83-mock-path.log` and the
screenshot is `qa83-mock-defaults.png`, all under the run evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-dc274dc5-ec1d-46b0-8bb3-d7b0f6792889/`.

## Required reassessment and remaining coverage

The live-only proposed remedy is disputed, rather than a product defect being
claimed fixed. Reviewer reassessment is required against the current mocked-F1
policy. The four **native-only** criteria are not marked passed or waived:

| Criterion | New evidence and remaining gap |
| --- | --- |
| generation-indexed-evidence | Indexed output transport passed with a mock; live generation remains unverified. |
| default-explicit-resumption | Real dashboard submission and continuation passed with a mock; live-provider continuation remains unverified. |
| suggestions-do-not-invent-or-authorize | No new model reasoning evidence; the planning-only/missing-account native scenario remains unverified. |
| ticket-explicit-answer-compatible | Real existing-session reply and continuation passed with a mock; live-provider continuation remains unverified. |

QA remains blocked under its current native-only scope. If native coverage is
retained after reviewer reassessment, obtain explicit provider-credit authorization
and schedule those cases as capacity-managed workflow steps. Do not infer a pass
from these canned outputs. No live Taskbot delivery or status reconciliation was
tested; the original backlog snapshot versus in_progress receipts limitation remains.

## Merge compatibility check

Re-ran the same mocked fixture while merging base
`1b30cfb0de2959f1cba16a5263525ddd32318052` into PR head
`71cf988d787841a8ddb24a97327837cc9e6a997d` (uncommitted merge tree).
Dashboard build: `c865e5b75642dfeee4f49da5`. Both explicit answer paths passed
with one mocked continuation and one receipt each. Inspected the fresh headless
screenshot: both recommendations, reasons, custom controls and Send answers
remain readable. Root build/typecheck and Biome passed (29 existing warnings).
All 211 tests in eight focused suites passed, including recommendation validation,
question batching, workflow recovery, server/PWA handling and merge readiness.
The test-file conflicts retained both recommendation and workflow-recovery tests.

Receipts and screenshot are in the original evidence directory's `ci-merge/`
subdirectory. This compatibility check uses canned outputs; all prior native
coverage and ticket synchronization limitations above remain recorded.
