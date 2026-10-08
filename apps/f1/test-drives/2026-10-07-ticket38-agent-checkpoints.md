# Ticket 38: preserve agent checkpoint payloads

**Date:** 2026-10-07
**Finding:** BF38-003, third review round
**Candidate:** `7b8ecf11` plus this commit's checkpoint preservation fix

## Scenario and assertions

Migration changes resumable workflow state, so F1 applies. This embedded drive
extends the previous completed-receipt fixture with interrupted agent runs:
one has a completed result awaiting finalization, and one has a rejected output
awaiting correction. Both payloads contain owned paths, MCP permissions,
conflicting old/new home keys and a session-shaped data object. Preview/apply
must preserve those values and must not discover the data object as a native
conversation. The real saved native checkpoint still requires a mapping.

```sh
F1_AGENT_MODE=mock bun run /Users/jappy/.cyrus/factory/evidence/manual-7f0c7c6e-cca1-4387-b7ee-7d81e06997ba/fixer-agent-checkpoint-migration-f1.ts
```

Passed on macOS ARM64 with Bun 1.4.2:

- Preview/apply succeeded with unchanged completed and rejected payloads.
- Real EdgeWorker completed-result recovery finalized the saved output once.
  Agent configuration was configured to throw on any unexpected replay.
- The mocked correction received the original rejected output. Both subsequent
  mocked consumer steps received the original payload, and both runs completed.
- The retained fixture executed both renamed direct/fanout MCP calls, consumed
  its original completed receipt, preserved history and a pending human review,
  and restored the migration backup successfully.

The evidence script and `fixer-agent-checkpoint-migration-f1.log` are in the run's
evidence directory. Agent calls, title generation and preparation were explicitly
mocked. The native continuation mapping is synthetic fixture evidence, not a
verified provider conversation. Migration, completed-result recovery, workflow
execution, permissions and local HTTP MCP transport were real. No provider
credits, live tracker or operator state were used. Prior reports remain intact.

## Targeted checks

All 25 migration/preservation/worktree tests passed. The new regression tests
compare complete migrated run values for completed and rejected payloads in root,
nested and Simple checkpoints, and verify that native session discovery ignores
payload data while still discovering the actual checkpoint. The transformation
tests reproduced the reported rewrites before the fix. CLI build/typecheck and
changed-file Biome passed.

Existing release-validation limitations and unverified live ticket state remain.
