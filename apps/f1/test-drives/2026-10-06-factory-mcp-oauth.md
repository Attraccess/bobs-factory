# Factory backend MCP OAuth and restart recovery

**Date:** 2026-10-06  
**Tested runtime commit:** `8abfda49698e835364d42849df22e122ba03e500`  
**PR:** [#22](https://github.com/Attraccess/bobs-factory/pull/22)

Factory HTTP MCP calls previously bypassed the selected Codex runner's OAuth
connection. The focused regression reproduced HTTP 401 despite a valid native
login. Authentication and ticket recovery are runtime behavior, so relevant F1
validation is required.

The isolated drive used the actual EdgeWorker, Factory runtime, Git worktree
creation, ticket adapters and bundled Codex 0.159.2 app-server. An HTTPS Taskbot
fixture exposed MCP tools and OAuth metadata/token endpoints. Its isolated
`CODEX_HOME` contained an expired fixture access token and a rotating refresh
token; no static authorization header was configured. Native Codex consumed and
persisted those credentials. The repository default was Claude while the accepted
Factory launch selected Codex.

## Commands and results

```sh
pnpm --filter 'cyrus-ai...' build
pnpm --filter cyrus-codex-runner test:run
pnpm --filter cyrus-edge-worker exec vitest run \
  test/EdgeWorker.factory-mcp-oauth.test.ts \
  test/EdgeWorker.workflow-triggers.test.ts test/TicketTracking.test.ts
node /tmp/f1-factory-oauth-20261006/drive.mjs \
  /Users/jappy/.t3/worktrees/bobs-factory/factory-mcp-oauth
pnpm build
pnpm typecheck
```

- All 79 Codex runner tests and 71 targeted EdgeWorker tests passed.
- Build, type checks and changed-file Biome checks passed.
- F1 returned `passed: true`, two refreshes and 20 authenticated MCP tool calls.
- Fresh fixture repository:
  `/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/f1-native-oauth-3v9cxe/repo`.
- Driver, generated fixture certificates, log and results remain in
  `/tmp/f1-factory-oauth-20261006/`. The CA was trusted only by fixture processes.

## Assertions

1. The accepted Codex run fetched the full Taskbot context and moved the ticket
   from backlog to In Progress through native OAuth. The first expired token was
   refreshed and its rotated refresh token persisted before subsequent calls.
2. A provider failure retained a pending review milestone and a readable error.
3. A new EdgeWorker loaded the saved run with identical history, questions and
   clarification checkpoint.
4. After expiring the saved fixture access token again, a tracking-only retry
   refreshed the rotated credential and synchronized the review status, comment
   and PR link. A second retry duplicated neither comments nor attachments and
   retained the original checkpoint.
5. Workers and native MCP child processes shut down cleanly.

A separate read-only smoke check against the existing production Taskbot login
successfully read ticket `bobs-factory/37` through the new helper. No credentials
were copied into Factory configuration.

## Limits

Agent clarification output was simulated. This drive validates backend
authentication, token rotation, ticket synchronization and persisted recovery;
it does not execute a model turn or mutate GitHub. The local provider fixture
uses native Codex's file credential store, while the live read uses the existing
macOS credential store. Other runners retain their existing backend transport.
