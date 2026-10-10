# Operator MCP recovery after merging main

Validated the merge of PR head `755260d5ee478169c83cdc2e3d1072ca46d1cd8e`
with base `4d0ffd783d1510edd796ec220688695e6fb17b6d`, including the conflict resolutions.

The local launcher now uses the base branch’s guided onboarding and shared
`config.json`. It atomically saves effective launch runner/model settings before
startup, preserving connection repairs and existing project identities. The base
branch’s multiple-project selection remains supported. Explicit launches without
a model clear stale model overrides; reopening the dashboard without launch
choices retains saved settings. Historical reports describe their earlier tested
revisions and are unchanged.

## Recovery with simulated agents

F1 is applicable to the combined runtime recovery behavior. The existing
`factory-operator-recovery.f1.test.ts` exercises an isolated real EdgeWorker,
repository and bare remote, live config reload and the compiled Node operator
stdio bridge. Agents are simulated with `F1_AGENT_MODE=mock` and injected mocked
runners. Taskbot responses and connection discovery are controlled fixtures.

After the merge, mandatory context preflight exposed a test setup problem:
the source test inherited the host binary launcher environment while running
under Node. The harness now clears that setting and supplies the compiled scoped
context bridge for the preflight. It does not skip the connection check.

The scenario passed: missing Taskbot transport is diagnosed and repaired through
MCP; authentication failure rejects retry; a successful same-transport read permits
retry; setup advances and the original run completes. A separate manual run also
completes and verifies read-only connection discovery. Unknown connections and
arbitrary tool arguments reject.

## Commands and results

- `pnpm install --frozen-lockfile`: passed; lockfile unchanged.
- `pnpm build`: passed for all configured build packages.
- `pnpm --filter bobs-factory-mcp-tools --filter bobs-factory-edge-worker --filter bobs-factory typecheck`: passed.
- `pnpm exec biome ci`: passed, with 19 warnings.
- `F1_AGENT_MODE=mock pnpm --filter bobs-factory-mcp-tools exec vitest run test/connection-discovery.test.ts test/factory-operator.integration.test.ts test/factory-operator-recovery.f1.test.ts --maxWorkers=1 --testTimeout=30000`: 10 tests passed.
- `pnpm --filter bobs-factory exec vitest run src/local.test.ts src/onboarding.test.ts src/github.test.ts --maxWorkers=1`: 23 tests passed, including restart persistence and multiple-project preservation.
- `pnpm --filter bobs-factory-edge-worker exec vitest run test/FactoryServer.test.ts test/EdgeWorker.factory-mcp-oauth.test.ts --maxWorkers=1`: 26 tests passed.
- `pnpm --filter bobs-factory-codex-runner exec vitest run test/callMcpTool.test.ts --maxWorkers=1`: 7 tests passed.
- `git diff --check`: passed.

No real-agent inference, real native OAuth or binary rebuild was performed.
Provider CI will be rechecked by the runtime after publication. The PR remains
draft and human review/approval requirements remain in effect.
