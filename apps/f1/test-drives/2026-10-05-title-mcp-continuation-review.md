# Project MCP and concurrent chat review fixes

Date: 2026-10-05. [Taskbot #68](https://taskbot.apps.janjaap.de/p/bobs-factory/t/68),
[draft PR #11](https://github.com/Attraccess/bobs-factory/pull/11).
Tested revision: `3673d80aafd32be453cc5459389748154b9cf8eb` plus this report's
review-fix changes. Previous reports and accepted recovery decisions are preserved.

F1 applies to the changed title-runner configuration and chat continuation
lifecycle. Assertions: source-project tools must reach the isolated naming job;
relative server scripts/data must resolve in the source worktree; dashboard and
platform feedback must never start concurrent runners for one conversation;
queued messages must survive setup waits and stop must cancel pending starts.

## Setup

Fresh F1 repository: `/tmp/title-second-review-f1-repo`. Isolated Cyrus home:
`/tmp/title-second-review-f1-home`. RPC: 43212; dashboard: 43211. This fixture
uses production EdgeWorker, CLI RPC/tracker, the F1 synthetic Slack dispatch
route and real authenticated Codex (`gpt-6.1-sol`). The Factory execution step
is a bounded script; no publishing role or production chat service is invoked.

The committed project `.mcp.json` runs `node tools/ticket.mjs data/ticket.txt`.
Both arguments are relative. The server implements `lookup_ticket(url)`, reads
its relative data file, and records its cwd and tool calls. The title agent
continues to run under `factory/title-jobs/`.

## Results

- **Relative MCP:** a ticket-URL launch with an explicit context-retrieval
  instruction starts with its run ID. A real tool call reads `data/ticket.txt`
  from `worktrees/MANUAL-e14439da`, while the title agent uses its auxiliary
  directory. The generated title is “Fix duplicate kiwi inventory counts after
  scanner reconnect.” Naming completes and survives worker restart.
- **Cursor:** a production `RunnerConfigBuilder` → `CursorRunner` → SDK-boundary
  probe uses source `.cursor/mcp.json`. The SDK receives the project server
  inline while its agent cwd remains isolated. A real MCP client launches the
  SDK-supplied command from the auxiliary directory and successfully reads the
  same relative project script/data. Only the SDK agent/model network boundary
  is stubbed; this is not a live authenticated Cursor model test.
- **Concurrent feedback:** browser **Ask a follow-up** starts dashboard feedback
  while the fixture deliberately blocks continuation skill/config resolution.
  A platform reply arrives during that wait and queues with the guard active;
  no native runner starts before release. After release, exactly two resumed
  native turns start, in order: `DASHBOARD_FIRST`, then `PLATFORM_SECOND`.
  Maximum simultaneous chat runners: **one**. Both use native Codex session
  `01a10cbb-cf19-7523-8a2b-12202eb24866` and the same workspace. The browser
  shows both responses and transitions to Done without refreshing.
- **Stop and restart:** after rebuilding the final source, restart preserves
  the generated title and completed naming job. Stopping another delayed
  dashboard continuation with a queued platform reply starts **zero** native
  turns after the delay is released. Its guard clears and status stays stopped.
- **Deterministic regressions:** Slack and Zulip both exercise dashboard-first
  and platform-first ordering through config resolution, thread catch-up and
  semaphore admission. Multiple queued replies resume sequentially. Stop is
  covered at each setup stage and immediately after a result schedules replay.
  All five title-provider configs preserve file/inline precedence, environment,
  source cwd and the original project configuration file.

The first diagnostic naming launch retrieved its URL-only ticket through the
relative MCP server, but an instrumentation hook called an unsupported runner
method and failed that fixture job. The hook was corrected before the passing
launch above. A later URL-only launch completed with a generic ticket title;
explicit retrieval made the successful context-derived title assertion
repeatable. No production implementation was changed for those fixture issues.

## Validation and evidence

```sh
./apps/f1/f1 init-test-repo --path /tmp/title-second-review-f1-repo
bun <evidence>/title-second-review-fixes/worker.mjs
CYRUS_PORT=43212 ./apps/f1/f1 ping
CYRUS_PORT=43212 ./apps/f1/f1 start-chat-session --channel C_SECOND_REVIEW --user U_TEST --text 'Answer INITIAL_READY only. Do not edit files or contact anyone.'
CYRUS_PORT=43212 ./apps/f1/f1 start-chat-session --channel C_SECOND_REVIEW --user U_TEST --thread-ts 1791214997.224 --text 'Answer PLATFORM_SECOND only. Do not edit files or contact anyone.'
node <evidence>/title-second-review-fixes/cursor-probe.mjs
pnpm --filter cyrus-edge-worker exec vitest run test/EdgeWorker.workflow-triggers.test.ts test/RunnerConfigBuilder.title-config.test.ts test/ChatSessionHandler.continuation.test.ts test/EdgeWorker.session-chat.test.ts test/chat-sessions.test.ts test/RunTitleGenerator.test.ts test/FactoryServer.test.ts test/EdgeWorker.missing-session-recovery.test.ts test/WorkflowRuntime.test.ts test/RunnerConfigBuilder test/RunnerConcurrency.test.ts test/AgentSessionManager --reporter=dot
```

**30 suites, 324 tests passed.** Changed-file Biome and `git diff --check` pass.
Repository commit hooks run the full build and typecheck before commit.
Live provider coverage is Codex/Slack; other providers and Zulip are covered by
configuration/regression tests, with the separate Cursor SDK-boundary probe.
This drive does not claim live Linear, GitHub, GitLab, Claude, Gemini or OpenCode
coverage. The isolated worker and browser have been stopped.

[Sequential browser responses](assets/2026-10-05-serialized-chat-feedback.png).
[Generated title from relative MCP](assets/2026-10-05-relative-mcp-generated-title.png).
Fixture scripts, runner/MCP logs, and passing JSON assertions are retained under
`title-second-review-fixes/` in the workflow evidence directory.
