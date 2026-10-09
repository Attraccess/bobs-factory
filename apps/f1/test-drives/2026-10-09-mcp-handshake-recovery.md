# Required MCP handshake failure recovery

Date: 2026-10-09. Base: `c2ee4dd5`, with the handshake classification fix in the working tree.

F1 applies because the change affects native agent startup, persisted infrastructure checkpoints and retry. The existing audit/context fixture used the exact Codex `required MCP servers failed to initialize: factory-context: timed out handshaking` message recorded in run `manual-58cb7337-4661-439e-a18e-6a7f063c4cae`. Agent failures and reasoning were scripted through `MockAgentRunner`; the drive exercised the actual CLI issue tracker, compiled EdgeWorker, protected Factory APIs, scoped stdio MCP server and isolated Git worktree. No production run, external ticket, inference or provider credits were used.

```sh
F1_AGENT_MODE=mock FACTORY_AUDIT_STARTUP_FAILURE=handshake FACTORY_AUDIT_NATIVE_FAILURE=result FACTORY_AUDIT_EVIDENCE=/tmp/bobs-mcp-handshake-f1-evidence node apps/f1/test-drives/assets/factory-audit-review-context.mjs
pnpm --filter bobs-factory-edge-worker exec vitest run test/EdgeWorker.capture-recovery.test.ts test/FactoryAttemptOutcomes.test.ts test/WorkflowRuntime.test.ts
```

The drive completed and retained evidence in `/tmp/bobs-mcp-handshake-f1-evidence`:

- The recorded handshake failure saved its precise infrastructure reason without inventing a native session. Explicit Retry resumed the failed role.
- Completed implementation and CI each ran once. Reviewer assistance resumed only the required reviewer; an incomplete empty review could not approve.
- A subsequent scripted native error preserved the rejected guide output and refunded its correction reservation. Restart retained the native conversation, completed receipts and unchanged revision; Retry completed the guide.
- Attempt provenance included an infrastructure retry and preserved effective instruction hashes across restart. The F1 CLI rendered timestamped activities before restart.
- The isolated worker stopped in cleanup. Production service and state were untouched.

The targeted suite passed 153 tests. Before the fix, all five new handshake cases failed because the infrastructure checkpoint was absent. Tests cover both rejected starts and native error results for start/resume, retained correction budgets and a fresh startup without a fabricated session.

Limitations: this establishes recovery from the recorded error, not the cause of the intermittent native handshake stall. The fixture uses mocked Claude roles to exercise the shared native-error boundary; Codex startup/result paths are covered by the focused EdgeWorker tests. Its in-memory CLI tracker resets during worker reconstruction, so post-restart activity forwarding logs the already-documented missing-session errors; persisted Factory recovery and pre-restart rendering pass. A separate direct handshake against the installed native helper succeeded, without model work.
