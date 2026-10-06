# HTTP MCP transport in title jobs

Date: 2026-10-05. [Taskbot #68](https://taskbot.apps.janjaap.de/p/bobs-factory/t/68),
[draft PR #11](https://github.com/Attraccess/bobs-factory/pull/11).
Tested revision: `ac9d4d720fc4dcd3009d8abbcc7f1c234b848c62` plus the HTTP
normalization change in this commit. Earlier reports and accepted fixes remain
unchanged.

F1 applies to the title-runner configuration change. Assertions: URL-only project
and explicit-file HTTP servers must connect from the isolated title directory;
file precedence and authentication must survive materialization inline; a real
Claude lookup must provide the context used in the generated title. Explicit SSE
types, relative stdio execution and all five provider configurations retain their
existing regression coverage.

## Fixture and results

Fresh repository: `/tmp/title-http-review-f1-repo`. Isolated Cyrus home:
`/tmp/title-http-review-f1-home`. F1 RPC: 43222; dashboard: 43221. A local HTTP
JSON-RPC server serves the project context and authenticated ticket lookup.
Both the project `.mcp.json` and repository override omit `type`. The production
EdgeWorker, RunnerConfigBuilder, ClaudeRunner and Claude SDK **0.3.281** execute
the naming job with the authenticated `haiku` model. Workflow execution is a
bounded three-second script; no delivery/publishing roles run.

- The manual launch returns its run ID as the provisional title and starts
  workflow execution with naming pending.
- Both URL-only servers initialize successfully through the real Claude SDK.
  The explicit repository file overrides the project's ticket URL. The final
  lookup sends the configured Authorization header and calls `lookup_ticket`
  with `http://ticket.fixture/68`.
- The title agent runs under `factory/title-jobs/`, while project discovery
  uses the source worktree. The project and override files remain URL-only.
- The run becomes **Fix cobalt scanner duplicate inventory on reconnect**,
  using task details available only from the MCP response. Naming state is
  completed. The browser displays that title and the completed script result.
- Workflow completion is recorded at `15:58:10.809Z`; title completion follows
  at `15:58:16.774Z`, confirming execution did not wait for naming.

The first diagnostic launch successfully connected its project servers but
could not retrieve a ticket: the fixture had a repository tool override and only
a platform MCP override. Repository overrides own their MCP files, so the fixture
was corrected to use `repository.mcpConfigPath`. That diagnostic job retained its
run ID and failed naming. No production change was needed for this fixture error.
The passing launch above used the corrected fixture scope.

## Checks and evidence

```sh
./apps/f1/f1 init-test-repo --path /tmp/title-http-review-f1-repo
pnpm install --frozen-lockfile
pnpm --filter cyrus-edge-worker build
bun <evidence>/title-http-review-fixes/worker.mjs
CYRUS_PORT=43222 ./apps/f1/f1 ping
CYRUS_PORT=43222 ./apps/f1/f1 status
pnpm --filter cyrus-edge-worker exec vitest run test/RunnerConfigBuilder.title-config.test.ts test/RunTitleGenerator.test.ts test/EdgeWorker.workflow-triggers.test.ts test/ChatSessionHandler.continuation.test.ts test/EdgeWorker.session-chat.test.ts --reporter=dot
pnpm --filter cyrus-claude-runner exec vitest run test/ClaudeRunner.test.ts test/env-isolation.test.ts --reporter=dot
pnpm exec biome check packages/edge-worker/src/factory/TitleMcpConfig.ts packages/edge-worker/test/RunnerConfigBuilder.title-config.test.ts
git diff --check
```

**Seven suites, 98 tests passed.** The modified provider fixture failed for
missing HTTP discriminators before the fix and passed afterward. It also checks
authenticated headers, explicit SSE transport, inline precedence, relative
stdio scripts/data and unchanged project files. The repository commit hook runs
the full build and typecheck.

[Browser evidence](assets/2026-10-05-http-mcp-generated-title.png).
Fixture scripts, raw SDK session logs, MCP requests, title configurations,
launch/run snapshots and `validation.json` are retained under
`title-http-review-fixes/` in the workflow evidence directory, with SDK session
logs in the isolated Cyrus home. The fixture worker, HTTP server and browser are
stopped after verification. This drive claims live Claude/local HTTP MCP coverage;
other providers use configuration tests. It does not claim live Linear, GitHub,
GitLab, Slack, Zulip, Cursor, Gemini, Codex or OpenCode model coverage.
