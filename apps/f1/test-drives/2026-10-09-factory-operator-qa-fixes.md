# Factory operator QA fixes

Operator failures now identify the instance and requested run and explain the next
recovery step. Overlapping connection edits return `stale_configuration`, while
overlapping run actions retain `stale_state`. The connection-check walkthrough
now describes selected-server discovery.

## Revision and scope

Tested base: `0f4c67269290c21f1ace3de350ecc42c1c215b44` with this QA-fix delta.
SHA-256 of sorted changed paths and bytes separated by NULs, excluding this report:
`c90b8e26c921b1740dba61ed986e974db5435fd383f3822d302822fce6ad16f4`.

F1 applies to the operator recovery workflow. The existing isolated EdgeWorker
drive uses a temporary Git repository and bare remote, configuration reload and
the compiled CLI stdio MCP bridge. Agents use `F1_AGENT_MODE=mock` and injected
`f1AgentHandlers`; Taskbot and connection discovery use controlled responses.

## Failed criteria retested

- Unknown tools, unknown runs and invalid arguments return the expected error
  category, instance identity, requested run ID when supplied and useful recovery
  guidance through MCP SDK calls. Rejected calls preserve the run and invoke no
  agents. Credential-bearing and oversized invalid run IDs are sanitized/bounded.
- A valid connection edit is held inside its update hook. A second SDK edit
  rejects as `stale_configuration` and explains how to refresh the configuration
  revision. No second update is dispatched. A concurrent run retry still rejects
  as `stale_state`. Releasing the first edit permits another edit.
- The F1 drive repeats unknown-tool, unknown-run and invalid-schema calls through
  the compiled CLI bridge to the real worker listener. Missing authentication
  includes instance/run context and guidance without exposing provider secrets.
- The existing missing-Taskbot recovery completes after configuration repair and
  reload, retaining the accepted runner. Ordinary manual-run connection discovery
  still passes, and arbitrary provider-tool arguments remain rejected.

## Commands and results

```sh
F1_AGENT_MODE=mock pnpm --filter bobs-factory-mcp-tools test:run test/factory-operator.integration.test.ts test/factory-operator-recovery.f1.test.ts
pnpm --filter bobs-factory-edge-worker build
pnpm --filter bobs-factory-edge-worker typecheck
pnpm --filter bobs-factory-mcp-tools typecheck
pnpm exec biome check packages/edge-worker/src/factory/OperatorService.ts packages/edge-worker/src/factory/OperatorServer.ts packages/mcp-tools/test/factory-operator.integration.test.ts packages/mcp-tools/test/factory-operator-recovery.f1.test.ts
git diff --check
```

All 11 selected tests, the affected worker build, both package typechecks, Biome
and diff checks passed. Execution log: `qa-fix-operator-20261009.log` in the run's
evidence directory. The first test run exposed an incorrect expected redaction
marker in the new test; it was corrected to the existing `[redacted]` behavior.

No dashboard rendering changed and no screenshots were selected by the QA scope.
No real-agent inference, native binary rebuild or real native OAuth check was
performed in this correction round. The simulated evidence confirms orchestration
and error contracts; it does not establish real provider authentication.
