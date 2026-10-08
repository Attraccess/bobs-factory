# Ticket 38: preserve completed migration receipts

**Date:** 2026-10-07
**Finding:** BF38-003, second review round
**Candidate:** `061842b7` plus this commit's scoped migration fix

## Scenario and assertions

The F1 applicability policy applies to migration of resumable workflow state.
This focused embedded drive extends the previous MCP migration fixture with a
completed script output containing `workflow`, `workflowDefinitions`, an owned
path, an MCP permission and an arbitrary non-definition array. It migrates a
waiting run, reloads it through EdgeWorker, answers the clarification, executes
the renamed direct/fanout MCP steps, and asserts that the final mocked agent
receives the original completed output. A separate pending review remains gated.

```sh
F1_AGENT_MODE=mock bun run /Users/jappy/.cyrus/factory/evidence/manual-7f0c7c6e-cca1-4387-b7ee-7d81e06997ba/fixer-receipt-migration-f1.ts
```

Passed on macOS ARM64 with Bun 1.4.2:

- Preview/apply accepted the opaque completed output without interpreting it as
  executable definitions. Every original output and history value survived.
- The run's top-level frozen workflow and definition tool names migrated.
- The replacement run waited for an answer and made no premature MCP calls.
- After the answer, both renamed tool steps reached the local HTTP MCP fixture.
- The final agent received the unchanged completed receipt; the completed script
  executed exactly once across migration and resume.
- Checkpoint, prompts, pending review and empty human decisions were preserved.
  Answering the review as a clarification was rejected. Shutdown/restore passed.

The result log is `fixer-receipt-migration-f1.log` beside the evidence script.
Coding/title agents and preparation hooks were explicitly mocked; the workflow
runtime, migration, EdgeWorker tool dispatch, permissions and MCP transport were
real. This uses no provider credits, live tracker or operator home. It does not
establish native agent continuation, all-platform binaries or live ticket sync.

## Targeted checks

All 22 migration/preservation/worktree tests passed, including complete run
equality for workflow-shaped outputs in nested checkpoint frames, history,
review gates, human decisions and ticket receipts. CLI typecheck/build and
changed-file Biome checks passed. Existing release-validation limitations remain;
historical F1 reports are retained.
