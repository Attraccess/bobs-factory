# Factory operator review fixes

Both review findings are fixed. Local launches persist their current runner and
model before worker startup, alongside connection repairs and unrelated settings.
Ordinary manual runs can select a configured connection for read-only discovery
through their effective transport and authentication.

## Revision and scenario

Tested base: `e0c742883eef9b9be5c75871fff06a1057590e89` with the review-fix delta.
SHA-256 of sorted changed paths and bytes separated by NULs, excluding reports:
`5c4f3993f0e0bc88aa6669eb9eb997d2ffccabd4cddf599a7b93ffd8cb6e34a2`.

F1 remains applicable to connection transport and recovery changes. The extended
`factory-operator-recovery.f1.test.ts` uses a real isolated EdgeWorker, configuration
reload, Git repository and bare remote, plus the compiled Node CLI stdio bridge.
`F1_AGENT_MODE=mock` and injected `f1AgentHandlers` simulate agents. Taskbot and
connection-discovery adapters return controlled responses.

The existing missing-Taskbot recovery passes. An additional ordinary manual run
completes and checks a selected connection through operator MCP. It receives
`connected: true` with `operation: tools/list`. Unknown servers reject, and arbitrary
provider-tool arguments fail schema validation. Discovery invokes no provider tools.

## Focused regression checks

- Local restart changes OpenCode/old-model to Codex/new-model. The saved configuration
  equals the startup configuration and retains MCP paths, allow/deny entries,
  repository metadata and unrelated settings. Omitting the model clears stale
  overrides. A different repository cannot reuse the retained home identity.
- Transport checks use native discovery for Codex HTTP and direct discovery for
  other runners, with the accepted child environment and credential references.
  Unknown and ambiguous connections reject; authentication failures propagate.
  No provider tool calls occur during discovery.
- Native Codex request tests check selected-server status without a model turn or
  tool call. Missing or failed discovery rejects and closes the connection.
- A real synthetic stdio MCP service verifies direct discovery with an empty
  catalog and rejects canceled discovery.
- Existing operator SDK integration tests retain scope, stale-state, recovery,
  question, configuration and revocation coverage.

## Commands and results

```sh
pnpm --filter 'bobs-factory...' build
F1_AGENT_MODE=mock pnpm --filter bobs-factory-mcp-tools exec vitest run test/connection-discovery.test.ts test/factory-operator.integration.test.ts test/factory-operator-recovery.f1.test.ts --maxWorkers=1 --testTimeout=30000
pnpm --filter bobs-factory exec vitest run src/local.test.ts --maxWorkers=1
pnpm --filter bobs-factory-codex-runner exec vitest run test/callMcpTool.test.ts --maxWorkers=1
pnpm --filter bobs-factory-edge-worker exec vitest run test/EdgeWorker.factory-mcp-oauth.test.ts --maxWorkers=1
```

All 30 selected tests passed. Build, affected-package typechecks, changed-file
Biome checks and `git diff --check` passed. No native binary rebuild, real-agent
inference or real native OAuth check was performed in this fix round. Historical
native binary evidence remains in the earlier report; it is not claimed as fresh
validation of this delta. Discovery confirms connection/catalog access, not the
permission or success of any particular provider tool.
