# Dirty worktree context readiness and recovery

Date: 2026-10-09. Tested runtime and fixture tree: `7d87d2c8`, based on `9bf8a4c40149`.

Factory's caller requested `submit_result_artifact` even when the scoped helper had no clean-revision artifact binding. The native required-server check rejected the absent tool before model work. The changed caller derives this permission from the same binding used to construct the helper.

## Reproduction and checks

Before the fix, the installed helper advertised only `list_context` and `read_context` without an artifact binding. Two fresh/resumed dirty-worktree regression cases failed because the caller still requested artifact submission. The F1 fixture, changed to read the actual scoped stdio helper catalog, reproduced the exact `missing tools: submit_result_artifact` error with the original caller.

After the fix:

```sh
pnpm --filter bobs-factory-edge-worker test:run test/EdgeWorker.capture-recovery.test.ts
pnpm --filter bobs-factory-codex-runner test:run test/AppServerCodexBackend.test.ts test/CodexRunner.mcp-config.test.ts
pnpm --filter bobs-factory-mcp-tools test:run src/factoryContext.test.ts
F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/codex-context-readiness.ts
```

All 34 recovery tests, 44 backend tests, 7 MCP configuration tests and 13 context/artifact tests passed. Full workspace build/typecheck passed in commit hooks.

## F1 results

F1 creates four issues and runs nested workflows through EdgeWorker, CodexRunner, required-server readiness, persisted checkpoints and the authenticated Factory retry endpoint. MCP inventory comes from the real scoped stdio helper; app-server/model events and intentional failures are scripted.

| Scenario | Assertions and result |
| --- | --- |
| Interrupted implementation with dirty work | First scripted native turn edits the worktree and fails. Restart preserves the clarification history, edit and native conversation. Retry attaches the two context-read tools, reaches the next turn in the same conversation and commits the existing edit. Later clean guide startup includes artifact submission. Workflow completes; prior roles are not replayed. |
| Fresh context discovery failure | No model turn starts or native session ID is invented. Infrastructure checkpoint survives restart. Explicit retry completes and preserves the three accepted roles. |
| Discovery failure during output correction | Rejected output and remaining correction budget survive failure/restart. Retry resumes the same guide conversation and completes. |
| Exhausted output corrections | Bounded correction budgets remain enforced; explicit retries authorize new bounded cycles without replaying accepted roles. Final retry completes. |

Activity endpoint and F1 session views contain activities for all four runs; all capacity slots are released. Worker and HTTP server stop cleanly. Final output: `F1_CONTEXT_RECOVERY_PASS`.

Local evidence: `/var/folders/_r/fld8l71j7ts635hlb5vtgnb80000gn/T/f1-codex-context-Q5AsNk` (receipts, four final run records and activity views). Initial red evidence: `/tmp/f1-catalog-red.log`.

This is mocked inference with real helper discovery. It does not establish paid native model behavior, completion of the user's production tasks, or resolution of the separate earlier 45-second handshake timeout. Dirty guide finalization still rejects unreviewed revisions; the successful dirty recovery scenario uses implementation, which owns committing its work.
