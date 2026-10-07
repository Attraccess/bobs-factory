# Specialist review integration with the Factory fork and compact history

Date: 2026-10-08
PR: [#32](https://github.com/Attraccess/bobs-factory/pull/32)

## Scope

Merge `origin/main` at `73f9ce45` into specialist review at `1c6c1965`.
Preserve specialist coverage and dispute exports alongside the renamed package
runtime, compact history, question explanations and durable notification batches.
Historical F1 reports remain retained.

## Executed verification

- `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck`, `pnpm biome ci`
  passed. Biome retains 18 existing warnings.
- `env -u BOBS_FACTORY_INTERNAL_EXECUTABLE pnpm -r test:run` passed across the
  monorepo, including 1,492 edge-worker tests and one existing skipped test.
  The installed binary flag is excluded because source-test subprocesses use Node,
  which cannot execute the binary-only `internal` command. Snapshot fixtures now
  locate their context file in both argument formats.
- `F1_AGENT_MODE=mock F1_EVIDENCE_DIR=<evidence>/ci-r8 bun
  apps/f1/test-drives/assets/qa-question-restart.mjs` passed. Assertions cover
  unchanged and legacy restored waits, changed recommendation notifications,
  stale-answer rejection and completion only after explicit fixture answers.
  Requests use isolated authenticated server sessions. Recreating the fixture
  server replaces only its own fixture credential/session to support restart.
- `F1_AGENT_MODE=mock bun <evidence>/ci-r8/integration.mjs` passed through the
  production EdgeWorker, F1 CLI, runner-config and output-finalization boundaries.
  It corrected malformed extraction output, preserved recommendations, blocked
  reviewers until explicit fixture submission, and executed six configured
  specialists against one frozen revision. Each reviewer read the compact memory
  through a production MCP server/client. Executed local validator assertions
  support complete requirement coverage.
- `node scripts/qa-recipes-focus.mjs http://localhost:3971
  <evidence>/ci-r8/focus <evidence>/ci-r8/focus-auth-state.json` passed.
  Fresh headless browser session; trusted pointer and keyboard openings at 1280px
  and 430px. Escape restored focus to the exact opening button in all four cases.
  Labelled controls and scrolling assertions passed; saved configuration unchanged.
  Inspected `focus-keyboard-430.png` directly.

## Evidence and limits

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-0b7cf77f-8296-4e61-9df5-b03561e59729/ci-r8`

Receipts: `results.json`, `qa-question-restart.json`, `focus/focus-receipts.json`.
Workers and the named headless browser session were stopped after verification.
All agents and tracker boundaries are simulated. Real-agent judgment, physical
passkeys and production connectivity remain unverified. No provider credits,
PR approval, readiness mutation, publication or merge was performed by this step.
Existing ticket-sync receipts are delivered; historical capacity-lock and
iteration-limit incidents remain recorded limitations.
