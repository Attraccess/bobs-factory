# Prepared execution tools in binary installations

**Date:** 2026-10-08
**Behavior:** Execution-profile preview and admission validate the tool selected by
its runner. Cursor retains its prepared SDK and Node paths with a private HOME.
**Source:** PR #30, fixes following base `65c23d782cf0778683f1c07fe8b7de75c451e2fb`.
The binary receipt records the final tested candidate's exact commit and build
metadata. The first development candidate included the pending fix diff.

## Assertions and results

- Compiled macOS ARM64 binary, launched from an isolated state home: authenticated
  Claude, Codex and Cursor previews returned HTTP 200, identifying prepared tools
  instead of trying to resolve checkout packages.
- Changing the prepared Codex fixture from 0.159.2 to 0.160.1 caused preview and
  admission to return HTTP 409 with the unsupported-version message. Admission
  created no run. The existing capability gate is preserved.
- The binary's separate Cursor execution worker loaded a controlled SDK 1.0.19
  through the configured Node 24.21.0. It returned a successful result. The SDK
  receipt confirmed the selected API credential, private HOME, retained SDK/Node
  paths and absence of an ambient GitHub credential. The SDK path originally used
  `~/` and was expanded before the private HOME was assigned.
- Embedded F1 EdgeWorker with `F1_AGENT_MODE=mock` and injected
  `f1AgentHandlers("mock", ...)`: three manual workflows completed with simulated
  Claude, Codex and Cursor agents. Each received the selected configuration and
  produced accessible activity output. Cursor's agent configuration retained its
  prepared paths and selected credential. API run data did not expose the canary.
- The F1 admission probe rejected unsupported PATH Codex before preparation or run
  creation. Local worktrees were prepared by the fixture; the normal preparation
  hook then established sessions and title jobs. No remote repository setup was
  exercised. Title jobs also used simulated agents.
- All 115 focused tests passed: Claude executable/environment/spawn suites (17),
  execution capabilities/profiles/Factory/native-share suites (45), prepared
  Cursor SDK and IPC worker suites (6), Codex launch/backend/native-login suites
  (47). Build, full typecheck, full lint and `git diff --check` passed. Lint retained
  18 existing warnings.

## Commands and evidence

```sh
pnpm --filter 'bobs-factory...' build
pnpm --filter bobs-factory-claude-runner exec vitest run test/executable.test.ts test/env-isolation.test.ts test/spawn-claude-code-process.test.ts
pnpm --filter bobs-factory-edge-worker exec vitest run test/ExecutionCapabilities.test.ts test/ExecutionProfiles.test.ts test/FactoryExecution.test.ts test/NativeExecutionShare.test.ts
pnpm --filter bobs-factory-cursor-runner exec vitest run test/prepared-sdk.test.ts
pnpm --filter bobs-factory-cursor-runner exec vitest run test/CursorWorkerRunner.test.ts
pnpm --filter bobs-factory-codex-runner exec vitest run test/codexBinary.test.ts test/AppServerCodexBackend.test.ts test/inspectNativeLogin.test.ts
F1_AGENT_MODE=mock bun node_modules/.cache/fix57-f1.ts
bun run scripts/build-binary.ts --target darwin-arm64 --output /tmp/fix57-binary-final
FIX57_BINARY=/tmp/fix57-binary-final/bobs-factory-0.2.73-darwin-arm64/bobs-factory node node_modules/.cache/fix57-binary-drive.mjs
pnpm typecheck
pnpm lint
```

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-a51c4397-ff88-400d-ab07-b692f7f15df5`.
Receipts: `fix57-binary-receipt.json`, `fix57-f1-receipt.json`.
Fixture sources: `fix57-binary-drive.mjs`, `fix57-f1.ts`; import paths are relative
to their original `node_modules/.cache` execution location. Logs use `fix57-*`
prefixes. Owned fixture servers and IPC processes stopped after validation.

## Limits

Prepared Claude/Codex version launchers and Cursor SDK events in the binary probe
were controlled fixtures. Checkout Claude inspection used the installed SDK native
CLI without a model turn. No live model/API authentication, native Cursor network
execution or GitLab authentication is established. Prior live Codex subscription,
GitHub App/enterprise/hardware-signing limitations and the originating-ticket
synchronization discrepancy remain. Only macOS ARM64 binary execution was tested.
