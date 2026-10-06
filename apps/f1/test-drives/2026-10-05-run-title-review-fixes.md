# Run-title review fixes

Date: 2026-10-05. [Taskbot #68](https://taskbot.apps.janjaap.de/p/bobs-factory/t/68),
[draft PR #11](https://github.com/Attraccess/bobs-factory/pull/11).
Tested revision: `d7d85b3ce3c8c7265411856e3aabbe85e6950835` plus this report's
review-fix worktree changes. The previous automatic-title report is preserved.

F1 applies to the changed recovery, MCP and chat/session paths. This drive uses
production EdgeWorker and its dashboard, CLI tracker/RPC, and authenticated
native Codex (`gpt-6.1-sol`). The fresh repository is
`/tmp/title-review-f1-repo`, with isolated home `/tmp/title-review-f1-home`.
RPC port: 43192; dashboard: 43191. An initial port-3621 collision was resolved
by choosing unused ports. No production Slack credentials or ticket workspace
are used; the test-only Slack dispatch route matches `apps/f1/server.ts`.

The repository commits a project `.mcp.json` exposing `lookup_ticket(url)`.
There are **no explicit repository/platform MCP file paths**, so the lookup
specifically tests project configuration forwarding into the auxiliary runner.
The controlled server records its working directory and returns an inventory
counter task. The manual Factory fixture uses a bounded script rather than
publication roles; this drive does not exercise factory publishing.

## Assertions and results

- **Historical recovery and retry:** a saved running record without
  `titleGeneration` resumes and completes with “Historical counter
  investigation.” A subsequent failed-checkpoint retry returns HTTP 202 and
  completes with the same title and no naming metadata. No auxiliary job is
  created for this historical record.
- **Project MCP:** a URL-only Factory launch returns its exact run ID. The
  naming config forwards the worktree's `.mcp.json` while retaining an isolated
  title-job CWD. The real MCP log records the supplied Taskbot URL and a CWD
  under `factory/title-jobs/manual-7e4d99b1-1b35-49f4-b498-2dcc590363f1`.
  The title becomes “Fix banana inventory counter resets and display.”
- **Dashboard feedback:** F1 dispatches a synthetic Slack mention. Its completed
  session exposes `chat.available=true` and `mode=continue`. The browser's
  **Ask a follow-up** control submits feedback into the same conversation.
  Three accepted dashboard messages and their native responses are persisted.
  The final browser continuation transitions from Working to Done and displays
  “Confirmed: reconnecting must not duplicate scan counts” without refreshing.
- **Native identity and restart:** repeated worker restarts restore the chat
  to its platform handler. All continuations keep native Codex session
  `01a10ca7-3c74-7f71-9e2c-d4204c789d7f`, the same workspace, and title
  “Explain Why Scan Counters Reset Between Scans.” Completed naming jobs never
  repeat: exactly three configs exist for the manual root, chat root and new
  follow-up.
- **New workflow follow-up:** POSTing feedback to the Slack session's follow-up
  endpoint returns HTTP 202, creates
  `manual-ff5821a5-0cd0-41b4-b83d-c8817c42cf9e` in repository `local`, and retains
  `triggerOrigin.manual.sourceRunId`. Its new title becomes “Explain How to
  Prevent Duplicate Scan Counts After Reconnect.”

The initial browser attempt exposed a runtime notification that assumed all
session IDs were workflow-run IDs. After that fix, live completion validation
also exposed subscriptions created before chat handlers existed. Both defects
were corrected and the browser flow above passed with the final worker build.

## Commands and automated checks

```sh
./apps/f1/f1 init-test-repo --path /tmp/title-review-f1-repo
bun /tmp/title-review-f1-home/worker.mjs
CYRUS_PORT=43192 ./apps/f1/f1 ping
CYRUS_PORT=43192 ./apps/f1/f1 start-chat-session --channel C_REVIEW --user U_TEST --text 'Explain why scan counters must reset between scans. Do not edit files, implement work, contact anyone or publish anything. Answer briefly.'
pnpm --filter cyrus-edge-worker exec vitest run test/EdgeWorker.workflow-triggers.test.ts test/RunnerConfigBuilder.title-config.test.ts test/EdgeWorker.session-chat.test.ts test/chat-sessions.test.ts test/RunTitleGenerator.test.ts test/FactoryServer.test.ts test/EdgeWorker.missing-session-recovery.test.ts test/WorkflowRuntime.test.ts test/RunnerConfigBuilder test/AgentSessionManager --reporter=dot
pnpm build
pnpm typecheck
```

Targeted verification: **28 suites, 303 tests passed**. Changed-file Biome and
`git diff --check` pass. Repository build/typecheck and required commit hooks
validate the shared session metadata and event types. Deterministic tests cover
both Slack and Zulip, all five title-provider configurations, historical retry,
restored chat ownership, duplicate continuation prevention and stopped sessions.
Live provider coverage is Codex/Slack only; this report does not claim live
Zulip, Linear, GitHub, GitLab, Claude, Gemini, Cursor or OpenCode validation.

[Browser evidence after restart](assets/2026-10-05-chat-feedback-after-restart.png).
Fixture scripts, MCP call/config logs, native-identity assertions and check logs
are retained in the workflow evidence directory under `title-review-fixes/`.
The isolated worker and browser are stopped after the passing assertions.
