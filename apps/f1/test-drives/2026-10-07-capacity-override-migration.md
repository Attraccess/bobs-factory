# Ticket #38 custom capacity migration

Date: 2026-10-07. Tested the BF38-005 fix on top of `100950b1`.
The changed migration admission behavior affects coordinator preservation and
workflow resumption, so the relevant migration/resume scenario was exercised.
All agent responses were deterministic mocks; no native agent CLI or inference
API was invoked. The legacy admission barrier inspected the isolated fixture's
source coordinator, leaving the active factory hosting this role untouched.

## Commands and results

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-7f0c7c6e-cca1-4387-b7ee-7d81e06997ba`.

- `pnpm --filter bobs-factory test -- src/migration`: 133 CLI tests passed,
  including file and inherited old/new capacity-directory overrides, rechecking
  a changed environment at apply, no mutation when blocked, and policy/queue
  preservation after explicit reconciliation.
- `F1_AGENT_MODE=mock bun run <evidence>/fixer-capacity-override-migration-f1.ts`:
  custom pool with limit two and a parked queued request blocked apply. No backup
  or destination was created; source coordinator bytes remained unchanged.
- After a verified fixture backup and explicit relocation into the source home's
  `machine-capacity`, with the override removed, inspect/apply passed. The actual
  replacement EdgeWorker coordinator loaded limit two and queue sequence nine,
  reclaimed the original request ID and rotated its lease token on recovery.
- Existing mocked migration/resume assertions passed: two owned MCP calls,
  unchanged completed receipts, recovered completed agent result without replay,
  unchanged rejected payload received by a mock correction, unchanged payloads
  consumed downstream, pending review retained, and backup restore passed.

The fixture's first probe reached the host's active legacy admission barrier;
the corrected fixture explicitly selected its own source coordinator. Its next
probe incorrectly expected a recovery lease token to stay unchanged; the final
assertions verify retained request ID/sequence and the expected token rotation.
Neither probe changed production state. Fixture workers and mock server stopped,
and temporary state was removed.

## Limits

Custom/shared pools require explicit assistant reconciliation and verified
backups; automatic relocation/merging is intentionally unsupported. Overrides
in source `.env` and the helper environment are detected. Service definitions
remain discovery and cutover responsibilities of the migration assistant.
Prior release-validation limits, native x64 and authenticated Cursor test waivers,
the limited dependency-audit exception and unverified live ticket state remain.
