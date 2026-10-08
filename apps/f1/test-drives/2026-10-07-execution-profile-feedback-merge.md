# Execution profiles and feedback recovery integration

Date: 2026-10-07. Tested the pending merge of base `ec130ae0` into
execution-profile revision `07c9d029` for draft PR #30.

## Changes and applicability

Preserved both Unreleased changelog histories and the persistence fixture's
constructor initialization wait. Removed the duplicate `runnerSlots` declaration
introduced by the merge; the final fixture is unchanged from the PR head.
Feedback context reconstruction, output correction and recovery from main merge
cleanly with selected execution environments. No frontend behavior changed.

F1 applies to the combined runtime. Reused existing drivers, replacing their
absolute repository imports with this worktree's freshly built modules. All
providers used `MockAgentRunner`, with `F1_AGENT_MODE=mock`, title generation
disabled, scripted provider reads and unexpected provider writes rejected.
Each drive used a fresh repository/home and one independent capacity slot.

## Commands and results

- `pnpm build`, `pnpm typecheck`, `pnpm biome ci`: passed; Biome retains
  29 existing warnings.
- Focused EdgeWorker Vitest run: 237 tests passed across persistence, capture
  recovery, merge recovery, workflow triggers, execution profiles, feedback
  policies, merge readiness, review recovery and WorkflowRuntime (9 files).
- `F1_AGENT_MODE=mock bun /tmp/ci57-factory-legacy-feedback-drive.ts`:
  2 scenarios passed: exact pending-comment reconstruction under restricted
  recipe inputs and restart while waiting for assistance.
- `F1_AGENT_MODE=mock bun /tmp/ci57-factory-feedback-drive.ts`:
  6 scenarios passed: persistent ignore, exact-comment output correction,
  no-progress restart, fresh review after a source change, policy reversal
  and restricted-input context.
- `F1_AGENT_MODE=mock bun /tmp/ci57-factory-review-recovery-drive.ts`:
  4 scenarios passed: same-role correction/assistance, unchanged rejected
  finding recovery, actual source correction and visual-fixer assistance.
- Issue/session creation and response activities were checked through the F1
  CLI. All drives stopped cleanly and released capacity (zero active/queued).
- `git diff --check`: passed.

## Evidence and limitations

Receipts, supplied contexts, run JSON and logs are retained in
`/Users/jappy/.cyrus/factory/evidence/manual-a51c4397-ff88-400d-ab07-b692f7f15df5/ci57-feedback-merge`.
Original drive roots are `/tmp/factory-legacy-feedback-f1-oTawV0`,
`/tmp/factory-feedback-f1-iau9tj` and
`/tmp/factory-review-recovery-f1-3jG0yb`.

These are deterministic orchestration checks, with zero inference cost.
They do not establish native model interpretation, live authentication,
reviewer approval or merge. The operator's live runner/GitLab test waiver,
unverified live Codex subscription/GitHub App authentication and originating
ticket synchronization discrepancy remain. Earlier profile/UI evidence is
preserved; no new screenshot is needed for this runtime/test-only integration.
