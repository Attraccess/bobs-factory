# Legacy feedback context recovery

Date: 2026-10-07. Tested the working tree based on `ce61ddb6` on
`fix/legacy-feedback-context`. Driver: `/tmp/factory-legacy-feedback-drive.ts`.
Evidence: `/tmp/factory-legacy-feedback-f1-UREkoN`; output:
`/tmp/factory-legacy-feedback-f1.log`.

## Applicability and setup

F1 applies to the changed Factory agent context and recovered-result validation.
A real CLI-platform EdgeWorker used an unrelated fresh Git repository, isolated
home, one capacity slot, RPC 3600 and UI 3540. Every agent provider used a
deterministic MockAgentRunner; title generation was disabled. Provider reads were
scripted, and unexpected provider mutations failed. No native agent or inference
API ran. Both issues started through `apps/f1/f1 create-issue` and `start-session`.

## Scenarios and assertions

- **Legacy receipt with restricted inputs:** the CI fixer received only
  `draft-pr` through its recipe inputs. Before execution, the fixture removed
  `unassessedComments` and `feedbackPolicies` from the readiness outputs to model
  a receipt from before feedback recovery. Runtime-owned context reconstructed
  the exact pending ID, body and SHA-256. One fixer visit assessed that version
  and returned directly to readiness; the original single code review remained.
- **Restart during an assistance wait:** a fixture question parked the CI fixer.
  The worker stopped, and the saved readiness outputs were downgraded to the
  legacy shape. A new worker used the same home, with the external tracker and
  activity sink preserved. Recovery retained the wait without launching another
  role. An answer through `/api/runs/:id/answer` resumed the existing fixer with
  the reconstructed pending version and persisted its exact content assessment.
  Two total fixer visits and one code review completed.

Both fixtures completed their minimal workflow, retaining required human actions
and no approval or merge. `view-session` verified response activities. Full run
JSON, the downgraded checkpoint, supplied contexts, role counts and capacity
receipts are retained in the evidence directory. All agent result costs were
zero. Final capacity had zero active/queued requests, and the worker stopped
cleanly, releasing both ports.

## Other verification and production recovery

The legacy restricted-input regression failed before the fix because the context
omitted `unassessedComments`. It passed after the fix. Focused tests additionally
cover a saved completed result that claimed the wrong comment: validation names
the actual missing ID and corrects it in the same conversation. Existing feedback
policy and merge-readiness tests passed; EdgeWorker types/build, changed-file
Biome and diff checks passed.

The reported production run had the same legacy receipt. Its saved comments,
assessment history and already-authorized provider policy identified one edited
artifact notice still requiring assessment. The live GitHub API confirmed that
exact content hash and unchanged PR head. The supported answer API accepted
technical recovery context so the existing run could resume while other runs
continued. This operational recovery did not restart the production service or
claim that the running process had loaded the permanent repair.

Mocked F1 evidence establishes context reconstruction, persistence, validation
and routing. It does not establish native model interpretation or a real merge.
