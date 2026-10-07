# Ticket 38: migrated operational MCP references

## Scope and environment

Focused embedded F1 drive for review findings BF38-001 through BF38-003 on
macOS ARM64, Bun 1.4.2. Tested candidate: clean base `b7f4f8cc` plus this fix
commit's migration/environment changes. BF38-004 is covered by CLI bootstrap
and Application reload regression checks, including nonfatal read failures.

`F1_AGENT_MODE=mock` was required. The embedded harness explicitly replaced
EdgeWorker's coding-agent and title hooks with deterministic mocks. No agent
CLI/API, provider credits, external tracker or operator home was used. The
local HTTP MCP server returned fixed child-issue data through real MCP client
transport. EdgeWorker's FactoryTools dispatch and permission checks were real;
its runner-config builder was injected with the actual migrated configuration.
This covers the affected migration/resumption path, not live issue assignment,
authentication, all-platform binaries or native agent continuation.

## Command and assertions

```sh
F1_AGENT_MODE=mock bun run /Users/jappy/.cyrus/factory/evidence/manual-7f0c7c6e-cca1-4387-b7ee-7d81e06997ba/fixer-migration-f1.ts
```

The fixture created an isolated source home with a completed script receipt,
a waiting clarification, a direct owned MCP tool step, a fanout tool step and
a mock final response. It saved a separate pending-review run, then shut down,
previewed/applied migration, loaded the replacement EdgeWorker runtime,
answered the clarification, and restored the migration backup after shutdown.

Assertions passed:

- Server-wide allow permissions authorized the renamed tool; tool-specific and
  server-wide denials still rejected it.
- The MCP JSON reference relocated, its server key and endpoint changed, and
  both direct and fanout steps reached `/mcp/bobs-factory-tools` successfully.
- The replacement run remained waiting before an answer and made zero MCP calls.
  After the answer it completed with two MCP calls and `MOCK_F1_COMPLETE`.
- The completed script receipt executed once. Original history, checkpoint and
  prompt bytes survived apply; retained history remained unchanged after resume.
- The separate pending review kept its head, gate and empty decision array;
  attempting to answer it as a clarification was rejected.
- Restore succeeded. Disposable homes, capacity state and HTTP server were cleaned up.

The first fixture omitted required stock workflows; it was corrected. The
second incorrectly combined a pending review with a clarification on one run;
production correctly rejected the answer. The final fixture used separate runs
and passed. These were harness setup errors, not passing product evidence.

## Other checks and limits

Root build/typecheck passed; 126 CLI tests and 42 focused Factory/MCP tests passed.
Root lint passed with 18 existing warnings; changed-file lint and diff checks passed. Migration regression tests additionally
cover MCP credential/custom-server/backup preservation and rejection of external
reconciliation and colliding old/new server identities before backup.

Evidence script and result are in the run evidence directory above. Historical
test-drive evidence is retained. No release, merge, PR readiness change or tracker
lifecycle mutation was performed. Existing native-target, Cursor and immutable
release validation limits remain as recorded in the implementation status.
