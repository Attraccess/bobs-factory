# F1 drive: mocked agents by default

**Date:** 2026-10-07

**Tested revision:** `04f29693` plus the working-tree changes

**Behavior:** The standard F1 server uses mocks for sessions, Factory roles, chat,
and background titles unless explicitly started with `F1_AGENT_MODE=live`.

**Fixture:** `/tmp/cyrus-f1-mocks-JPy4Oa/repo`

**Evidence:** `/tmp/cyrus-f1-mocks-JPy4Oa/`

## Scenario and execution

Created a fresh repository with `apps/f1/f1 init-test-repo`, then started the
standard server with the mode variable absent, proving the default:

```sh
env -u F1_AGENT_MODE -u F1_MOCK_RESPONSE \
  CYRUS_DISABLE_REMOTE_SESSION_STORE=1 \
  CYRUS_PORT=3600 CYRUS_FACTORY_PORT=3540 \
  CYRUS_REPO_PATH=/tmp/cyrus-f1-mocks-JPy4Oa/repo \
  bun run apps/f1/server.ts

CYRUS_PORT=3600 apps/f1/f1 create-issue \
  --title 'Mock Codex routing' \
  --description '[agent=codex] Respond with the mock fixture.' --labels primary
CYRUS_PORT=3600 apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3600 apps/f1/f1 prompt-session \
  --session-id session-1 --message 'Continue with a second mock reply'

CYRUS_PORT=3600 apps/f1/f1 start-chat-session \
  --channel C_MOCK_TEST --user U_MOCK_TEST --text 'Mock chat hello'
CYRUS_PORT=3600 apps/f1/f1 start-chat-session \
  --channel C_MOCK_TEST --user U_MOCK_TEST --thread-ts 1791357250.66 \
  --text 'Mock chat continuation'
```

Through the real Factory API, appended a `mock-probe` recipe containing one
`agent` step with `runner: "cursor"`, `json: false`, then launched it manually.
The fixture driver (`drive.mjs`) asserted results from the API, agent events,
and persisted session receipts.

## Results

- Startup identified `mock (no API usage)` with no live-mode opt-in.
- The routed issue produced two normal `response` activities with the fixed
  mock reply. Persisted result entries shared the resumed `f1-mock-*` session
  ID; recorded usage and cost were zero.
- Slack dispatch and continuation each produced a mocked result, sharing one
  session ID. `/cli/chat-thread` returned the expected reply and
  `isRunning: false`.
- Background titles completed as `F1 mock run`, with valid title JSON and no
  title-generation failures in the final server log.
- Factory run `manual-c2486462-a050-485d-a509-277547827a82` completed its
  Cursor-selected role. `outputs.probe.text` matched the fixture; its result
  event had an `f1-mock-*` session ID, zero tokens, and `total_cost_usd: 0`.
- Nine F1 unit tests passed: default/invalid/live-mode selection, all five
  provider choices, structured output, resume identity, cancellation, and titles.
- 153 affected EdgeWorker tests passed, including runner selection, workflow
  launches/titles, capture recovery, chat, and instance isolation. The earlier
  capacity drive documents its additional targeted checks.
- Root `pnpm typecheck` and `pnpm build` passed; after the final title-fixture
  adjustment, F1 tests, type checking, and build passed again. Biome, diff
  whitespace checks, and shared-skill validation passed.
- Stopped the issue session, shut down the fixture server cleanly, and confirmed
  ports 3600 and 3540 were no longer listening.

## Limits and observations

This drive used deterministic mocks throughout. It validates Cyrus orchestration
and renderer output, not model reasoning, native provider tools, or CLI/API
integration. Live mode was not executed. Structured role contracts require a
matching `F1_MOCK_RESPONSE` or an embedded fixture handler.

The scaffold has no Git remote, so worktree setup warned about fetching `origin`
and used local `main`. Slack has no token; the test endpoints expose replies
without posting to Slack. An initial issue without a routing label reached
repository-selection elicitation and was stopped before the final drive. The
first exploratory default reply also revealed title JSON requirements; the mock
now supplies separate valid title JSON, verified in the final restarted server.
