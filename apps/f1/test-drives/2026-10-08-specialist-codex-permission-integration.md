# Specialist review with Codex launch permissions

Date: 2026-10-08

Candidate: PR #32 at `52f1e2d3`, merged with `main` at `b64db5e9`.
Only the changelog conflicted. Both entries were retained; the upstream runner
implementation was integrated unchanged.

F1 applies to the merged Codex startup behavior and its interaction with
concurrent specialist review. The drive used a fresh repository, linked Git
worktrees, an isolated Factory home and the real F1 issue/session RPC. Providers
were simulated. Codex roles used the production `CodexRunner`, configuration
builder, app-server backend and process manager with an injected scripted
transport. Cursor permission setup and cleanup used the production runner.
Other provider entry points used `f1AgentHandlers('mock')`.

Command from the repository root:

```sh
F1_AGENT_MODE=mock node /Users/jappy/.cyrus/factory/evidence/manual-0b7cf77f-8296-4e61-9df5-b03561e59729/ci-r14/mixed-f1.mjs
```

The scripted transport parsed actual launch overrides with Python's TOML
parser. All ten Codex launches selected the same named permission profile as
their thread requests and retained the worktree write grant. Issue assignment
selected the custom workflow and exercised extraction, concurrent Cursor
security review, Codex business coverage and aggregation.

Five scenarios passed:

- Clean completion: coverage finished while Cursor files were present;
  aggregation waited for cleanup and approved the unchanged, clean revision.
- A remaining tracked product edit prevented aggregation.
- A remaining untracked product file prevented aggregation.
- A remaining edit under `.cursor` prevented aggregation.
- An unexpected reviewer commit invalidated the frozen revision.

Every scenario released all active and queued capacity grants. The F1 activity
output retained final responses. Worker shutdown closed its listeners and the
temporary home was removed. Receipts and commands are in
`ci-r14/mixed-f1-results.json`; cleanup is in `ci-r14/cleanup.json`, under the
evidence directory above. An initial fixture run failed because its Python
snippet received an incorrectly escaped newline; the fixture was corrected
without weakening its permission assertions. The failed log is retained as
`ci-r14/mixed-f1.log`, and the passing log as `ci-r14/mixed-f1-final.log`.

Other validation passed: all 120 Codex runner tests, 165 focused EdgeWorker
tests, workspace build and lint (19 existing warnings). The merge commit's
pre-commit checks also run workspace build and typecheck.

This drive does not use a native Codex process or real inference. It establishes
launch/thread configuration consistency and specialist orchestration with a
scripted transport. The upstream native reload evidence remains in
`2026-10-08-codex-workspace-requirements.md`. Real-agent judgment, physical
passkeys and live notifications remain unverified. No PR approval, readiness
change or merge was performed by this drive. Earlier recovery limitations
remain documented in prior reports.
