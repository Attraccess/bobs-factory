# Provider MCP transport defaults in title jobs

Date: 2026-10-05. [Taskbot #68](https://taskbot.apps.janjaap.de/p/bobs-factory/t/68),
[draft PR #11](https://github.com/Attraccess/bobs-factory/pull/11).
Tested revision: `76ec72b96d9561d2194d6de89da9398a748ecaeb` plus this commit's
provider-specific normalization change. Prior reports and accepted fixes remain
unchanged.

F1 applies to this title-runner configuration change. Assertions: Gemini must
retain URL-only project and override servers as SSE, explicit HTTP servers must
remain HTTP, authenticated lookup must supply the generated title, and execution
must proceed concurrently. Claude must retain its accepted HTTP normalization.
Gemini selects SSE for `url` and streamable HTTP for `httpUrl`, as documented in
[its transport selection reference](https://geminicli.com/docs/tools/mcp-server/#1-server-iteration-and-connection).

## Fixture and results

Fresh repository: `/tmp/title-gemini-review-f1-repo`. Isolated Cyrus home:
`/tmp/title-gemini-review-f1-home`. F1 RPC: 43232; dashboard: 43231.
Production EdgeWorker, RunnerConfigBuilder, RunTitleGenerator and GeminiRunner
execute the job. Gemini CLI is unavailable here, so only its external model
process is replaced by a bounded executable fixture. That process reads the
production `.gemini/settings.json`, selects the documented native transports,
and uses the installed MCP SDK to connect to actual local SSE and HTTP servers.
It returns the title obtained from `lookup_ticket` as Gemini NDJSON events.
The main workflow is a one-second script; no delivery/publishing roles run.

- Manual launch returns the run ID as the provisional title with naming pending.
- Project discovery provides the URL-only project server. A repository override
  replaces the project's ticket URL and preserves its Authorization header.
- Generated native settings contain `url` for project and ticket, and `httpUrl`
  for the explicit HTTP server. All three servers initialize successfully.
- The authenticated SSE ticket server receives both the GET stream and POST
  messages, including `lookup_ticket` for `http://ticket.fixture/68`.
- The run becomes **Fix violet scanner duplicate inventory after reconnect**,
  with naming and workflow states completed. The browser displays the title,
  completed step and result.
- Workflow completion is recorded at `16:06:19.564Z`; title output follows at
  `16:06:22.397Z`. Execution did not wait for naming.
- The auxiliary title directory and temporary Gemini settings are cleaned up.
  The fixture worker, local servers and browser are stopped after verification.

This drive covers the production Gemini runner/configuration and actual local
MCP transport path. It does not claim live Gemini CLI/model, Linear, GitHub,
GitLab, Slack or Zulip coverage. Claude's earlier real SDK HTTP drive remains
valid, and the current five-provider configuration tests preserve that behavior.

## Checks and evidence

```sh
pnpm install --frozen-lockfile
pnpm --filter cyrus-edge-worker build
pnpm --filter cyrus-edge-worker exec vitest run test/RunnerConfigBuilder.title-config.test.ts test/RunTitleGenerator.test.ts --reporter=dot
pnpm --filter cyrus-gemini-runner exec vitest run test/GeminiRunner.test.ts --reporter=dot
pnpm exec biome check packages/edge-worker/src/factory/TitleMcpConfig.ts packages/edge-worker/test/RunnerConfigBuilder.title-config.test.ts
./apps/f1/f1 init-test-repo --path /tmp/title-gemini-review-f1-repo
bun <evidence>/title-gemini-review-fixes/worker.mjs
CYRUS_PORT=43232 ./apps/f1/f1 ping
CYRUS_PORT=43232 ./apps/f1/f1 status
git diff --check
```

**Three suites: 52 tests passed, one existing test skipped.** Before the fix,
the updated provider fixture failed because non-Claude file entries received
Claude's HTTP type. Afterward, all five providers pass. Gemini's normal file
loader and title-job inline configurations convert to the same expected native
remote settings, covering URL-only SSE, explicit SSE/HTTP, headers, precedence
and inline HTTP. Existing relative stdio scripts/data assertions also pass.
The repository commit hook runs the full build and typecheck.

[Browser evidence](assets/2026-10-05-gemini-sse-generated-title.png).
Fixture scripts, native settings, MCP requests, tool calls, launch/final snapshots,
raw runner logs and `validation.json` are retained under
`title-gemini-review-fixes/` in the workflow evidence directory, with SDK-compatible
runner logs in the isolated Cyrus home. An initial API request lacked the
required `x-factory-request` header and was rejected before any run was created;
the corrected request above passed.
