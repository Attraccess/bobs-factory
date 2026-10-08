# Bob’s Factory QA corrections

Date: 2026-10-07. Base revision: `fb1cdac7c984fc5d75565ade7146f7ab311a5fb0`
plus the QA correction diff in this commit. This is focused fixer validation for
PR #34, not release certification or a repeat of the full QA scope.

The changed F1-covered behavior is assistant activity attribution. A temporary
embedded EdgeWorker uses `F1_AGENT_MODE=mock` and an injected `MockAgentRunner`;
no agent CLI or inference provider is called. The fixture creates a CLI-tracker
issue, launches a stock Simple run through the dashboard API and emits a distinct
assistant thought before the final response. A separate user message continues
the same run. The current built dashboard is inspected headlessly.

Passed assertions for `bf38-simple-labels` (BF38-QA-001):

- Persisted assistant thought formats as `Bob’s Factory`; final response remains
  visible and Simple completes.
- The separately submitted user turn formats as `You`, retaining the exact
  text `Keep the existing Cyrus transcript intact.`
- The expanded browser conversation visibly attributes the thought to Bob’s
  Factory beside the Bob’s Factory session graph. The screenshot was opened
  and inspected, and the browser session and worker were closed afterward.

Passed assertions for `bf38-binary-boundaries` (BF38-QA-002):

- A native macOS ARM64 development binary, run outside the checkout with
  `PATH=/usr/bin:/bin`, rejects missing and file-valued repository paths.
- Both cases exit 1, identify the resolved path, offer `--repo <path>` recovery,
  omit the misleading `posix_spawn` message and create no worker state.
  The missing-directory case also explains creating a directory with `git init`.
- Binary startup/assets/API/MCP/shutdown/restart smoke passes with a valid Git
  repository. The artifact records the base SHA and `dirty: true`; it is local
  development evidence, not an immutable release candidate.

Commands and evidence:

```sh
pnpm --filter bobs-factory test -- src/local.test.ts
pnpm --filter bobs-factory-edge-worker test:run -- test/FactoryActivity.test.ts
pnpm build
pnpm lint
F1_AGENT_MODE=mock bun <evidence>/qa-fix-activity-f1.ts
agent-browser --headed false --session bf38-qa-fix-final-20261007 open <fixture-url>
bun run scripts/build-binary.ts --target darwin-arm64 --output /private/tmp/bf38-qa-fix-binary-20261007
BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY=/private/tmp/bf38-qa-fix-absent-legacy BOBS_FACTORY_SMOKE_PORT=4565 ./scripts/smoke-binary.sh /private/tmp/bf38-qa-fix-binary-20261007/bobs-factory-0.2.73-darwin-arm64/bobs-factory
```

The Vitest invocations ran all CLI and EdgeWorker files: 135 CLI tests passed;
1,341 EdgeWorker tests passed and one skipped. Build and lint passed (18 existing
lint warnings). Required build/typecheck checks also run in the commit hook.

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-7f0c7c6e-cca1-4387-b7ee-7d81e06997ba`.
Receipts: `qa-fix-activity-f1.ts`, `qa-fix-activity-f1.json`,
`qa-fix-activity-f1.log`, `qa-fix-simple-attribution.snapshot.txt`,
`qa-fix-simple-attribution.png`, `qa-fix-binary-boundaries.json`,
`qa-fix-binary-build.log`, `qa-fix-binary-smoke.log`, `qa-fix-build.log` and
`qa-fix-lint.log`.

The accepted native-target and authenticated Cursor waivers remain in effect;
this correction adds no provider-credit validation or publication claim. Past
BF38-001 through BF38-005 dispositions remain resolved. Live ticket state is
unverified; the runtime continues to own tracker synchronization.
