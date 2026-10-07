# Ticket #38 base reconciliation

Date: 2026-10-07. Tested the merged working tree of `54cf9b1a` and
`1b30cfb0`, including the conflict resolutions and final branding correction.
Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-7f0c7c6e-cca1-4387-b7ee-7d81e06997ba`.

F1 applies to the merged Factory lifecycle, harness mock boundary and UI
host/origin behavior. Every drive used `F1_AGENT_MODE=mock` and explicit mock
runners. No native agent CLI or inference API was invoked.

## Assertions and results

- Adapted the base's six-scenario recovery fixture to this worktree and renamed
  contracts (`ci-merge-recovery-f1.ts`). Failed QA reached correction and fresh
  evidence; incomplete evidence repeated once; an idle Codex error resumed once;
  stale handoff CI routed through correction and review; unchanged failed CI
  waited for assistance; an access wait survived restart and resumed after the
  fixture's explicit answer. All six completed. Results had zero inference cost.
  Final instance pool had zero active and queued work.
- The same fixture accepted the renamed explicit public UI origin and its
  same-origin write. Unrelated hosts and cross-origin writes returned 403.
- Ran the standard F1 server on a fresh repository (`ci-standard-f1.ts`). A
  Codex-selected issue produced the deterministic mocked response activity.
  Without public-origin opt-in, a foreign UI host returned 403.
- Replayed the prior migration fixture with the merged source. Completed and
  rejected agent payloads stayed unchanged, downstream consumers received them,
  completed results recovered without replay, two migrated MCP calls passed,
  pending review stayed pending, and backup restore passed.
- A fresh headless `agent-browser` session inspected Recipes and captured
  `ci-merge-dashboard.png`. The Instance capacity card rendered the Bob’s Factory
  name, default four-slot pool and idle counts. The browser session was closed.

Commands were `F1_AGENT_MODE=mock bun run <fixture.ts>`, root `pnpm build` and
`pnpm typecheck`, scoped EdgeWorker Vitest (227 passed), CLI suite (129 passed),
F1 suite (9 passed), root Biome (no errors, 18 existing warnings), and
`git diff --check`. Rebuilt the web assets after the final wording correction.

## Limits and cleanup

This is mocked orchestration evidence, not native provider validation. Prior
human waivers for native x64 and authenticated Cursor testing remain unchanged;
binary publication and live tracker state remain unverified. The recorded
limited dependency-audit exception remains. No dependencies changed in this step.

The initial browser probe used `/recipes` instead of the hash-router URL; the
corrected probe and final standard-server capture used `/#/recipes`. Fixture
workers and the standard server shut down cleanly. Production state was untouched.
