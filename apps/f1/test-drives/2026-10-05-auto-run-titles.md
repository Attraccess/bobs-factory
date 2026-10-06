# Automatic run titles

Date: 2026-10-05. [Taskbot #68](https://taskbot.apps.janjaap.de/p/bobs-factory/t/68).
Tested base: `58b33a4a9d3e1f23e84beb1efe78647660f5eabc`, with the uncommitted
automatic-title implementation in this worktree. No PR was created or published.

F1 applies because root launch, runner concurrency, session persistence and
dashboard naming behavior changed. The assertions below exercise those paths.

## Fixture

Built production EdgeWorker, CLI issue tracker and LinearActivitySink, authenticated
native Codex (`gpt-6.1-sol`), global title reasoning `low`, concurrency limit two.
Isolated home `/tmp/run-title-f1-home`, fresh Git repository
`/tmp/run-title-f1-repo-v2`, RPC port 3612 and dashboard port 3611.
The persistent fixture worker saves CLI tracker state as well as normal Cyrus
state. A controlled stdio MCP server exposes `lookup_ticket(url)` and records
actual calls. Its URL-only task describes banana inventory counter resets.
It does not access a production ticket workspace.

```sh
pnpm install --frozen-lockfile
pnpm build
./apps/f1/f1 init-test-repo --path /tmp/run-title-f1-repo-v2
bun /tmp/run-title-f1-home/worker.mjs
CYRUS_PORT=3612 ./apps/f1/f1 ping
CYRUS_PORT=3612 ./apps/f1/f1 create-issue --title 'Normalize invoice references in isolated worktree' --description 'Describe consistent invoice reference normalization briefly. Do not edit files, implement work, or publish a PR. Return a short explanation.'
CYRUS_PORT=3612 ./apps/f1/f1 start-session --issue-id issue-2
CYRUS_PORT=3612 ./apps/f1/f1 view-session --session-id session-2 --limit 100 --offset 0
```

The earlier setup attempt ran before the F1 CLI was built and lacked a valid Git
fixture. Its `DEF-1` run is excluded from passing worktree/isolation evidence.
After building F1, the fresh `v2` repository was initialized successfully and used
for every scenario below.

Factory/Takeover recipes retain their stock identities and launch permissions but
use a bounded `sleep 25; echo completed` script for this drive. The custom
`title-probe` recipe uses the same script. This checks launch and naming
lifecycle without executing publication steps or claiming full factory shipping
coverage. All fixture configuration is outside the repository.

## Observed results

| Path | Root | Result |
| --- | --- | --- |
| Ticket Simple | `session-2` / `DEF-2` | Separate real worktree; title becomes “Explain consistent invoice reference normalization”; native execution posts its normal final response. Source ticket title stays “Normalize invoice references in isolated worktree”. |
| Browser manual custom | `manual-793b6faa-053a-4c2c-b580-5b443aeb729e` | The URL-only launch returns with its exact ID. The MCP log records `https://taskbot.apps.janjaap.de/p/test/t/68`. While the script is still running, the title becomes “Fix banana inventory counter resets and display” and appears in the dashboard without refresh. |
| Manual Takeover | `manual-02788879-d6c0-4c52-afe6-59340e987249` | Resolves fixture ticket `DEF-3` and existing branch `def-3-repair-cached-scanner-totals`; context includes source identifier, ticket title/body and extra instructions. Title becomes “Verify cached scanner totals across successive scans”. |
| Takeover follow-up | `manual-f2bb1476-7cf5-4a1c-8fb6-198cff4dc7e1` | Fresh ID/title job, original worktree reused, explicit `triggerOrigin.manual.sourceRunId` points to the Takeover run. Feedback asks for reconnect checks; generated title is “Repair cached scanner totals across scans and reconnects”. |

Title config records show a separate CWD under
`/tmp/run-title-f1-home/factory/title-jobs/<root-id>`, model `gpt-6.1-sol` and
the configured MCP server. Completed auxiliary directories are removed.
Simple retains native execution ID `01a10c8a-dfa2-76a1-92b7-77a86803174b`.
Its eleven timestamped timeline activities include thought/tool events and one
normalization response; title-agent messages are not posted into that timeline.
The final activity was also checked separately at offset 10.

After the process restart, the final worker build reloads all four successful
titles and the saved global title settings. API assertions compare title, naming
job, status, worktree and trigger origin with the persisted snapshots. Runtime
session snapshots agree with their display titles. Five total auxiliary configs
(including the excluded preliminary run) and one MCP lookup remain unchanged:
completed jobs are not repeated. A subsequent graceful restart repeats these
assertions. Pending recovery and shutdown/late-result timing use deterministic
tests rather than a live model race.

## Browser evidence

Isolated `agent-browser` session `run-titles-manual373`, actual running dashboard.
Saved global provider/model/reasoning through Recipes. Switching Codex to Gemini
clears the model and incompatible reasoning/service controls; restoring Codex and
saving succeeds. Keyboard focus on Agent followed by Tab reaches the labelled
Model input. Simple, Factory, Takeover and custom start screens contain no title
field. Generated names render in both list and detail views.

Desktop 1280×900 and mobile 390×844 screenshots were inspected. On mobile,
`innerWidth === document.documentElement.scrollWidth === 390`.

- [Desktop title settings](assets/2026-10-05-run-title-settings.png)
- [Mobile title settings](assets/2026-10-05-run-title-settings-mobile.png)
- [Generated title after restart](assets/2026-10-05-generated-run-title-detail.png)

## Automated checks and limits

Targeted worker suites cover generator failures/deadlines, cancellation, primary
queue priority, isolated cleanup, UTF-8 context bounds, all five native config
builders, settings/API validation, stale refreshes, launch migration and legacy
inputs, live notifications, ticket Simple/Factory/Takeover roots, standalone chat
continuation, pending recovery and title-collision settlement. Shared builder,
session manager, chat, runner-selection and recovery regressions are included.

Final targeted run: **32 suites, 363 tests passed**.

```sh
pnpm --filter cyrus-edge-worker exec vitest run test/RunTitleGenerator.test.ts test/RunnerConfigBuilder.title-config.test.ts test/FactoryServer.test.ts test/WorkflowRuntime.test.ts test/FactoryAgentSettings.test.ts test/FactoryWebClient.test.ts test/EdgeWorker.workflow-triggers.test.ts test/RunnerConcurrency.test.ts test/EdgeWorker.runner-selection.test.ts test/RunnerConfigBuilder test/AgentSessionManager test/chat-sessions.test.ts test/EdgeWorker.missing-session-recovery.test.ts test/EdgeWorker.pr-review-trigger.test.ts --reporter=dot
```

`pnpm typecheck`, `pnpm build`, changed-file Biome checks and `git diff --check`
pass. Final test results and fixture evidence are saved in the factory evidence
directory for this step. No dependency versions or lockfile changed.

Live provider coverage is Codex only. Claude, Gemini, Cursor and OpenCode have
deterministic config/behavior coverage; this drive does not claim authenticated
live coverage for them, actual Linear/GitHub/GitLab delivery, or factory publishing.
The fixture worker and isolated browser session are stopped after validation.
