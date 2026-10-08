# Video and execution-profile integration

Date: 2026-10-08. Starting PR revision: `5d624fd8cfc9a236f7374cde67c8e5e330ea9432`.
Fetched base: `4912b9cba41202dbeaa262016e57f4753a8ee124`.
Checks ran on the resolved merge before its commit. Served web build:
`53870cb6e95eb651e180b624`.

Preserved video schemas, runtime validation, playback, prior review fixes and both
capability descriptions while integrating independent execution profiles. The
four conflicts affected changelogs and the full routing prompt/expectation.

## Executed evidence

- Build passed. All 352 targeted worker tests passed in 18 files, covering video,
  explicit profiles, runtime/recovery, guide/review, access and complete prompts.
  The initial run encountered host SSH signing in disposable test repositories.
  The replacement run disabled signing only in those test commands; production
  Git configuration was unchanged.
- `F1_AGENT_MODE=mock` replay created/fetched an isolated CLI-tracker issue and
  used deterministic runtime hooks. Real execution-environment resolution retained
  explicit identity/tool snapshots across capture, acceptance, gates, rejected
  reuse and restart. Ten role executions resolved the private fixture environment.
  The dummy provider key was never used for a provider call.
- All four linked scenario mutations rejected old recordings; an unrelated story
  reused them and passed the real media gate.
- Startup cleanup removed 200 assets, then the remaining six on the next restart.
  Historical metadata and accepted profile snapshots survived; expired media
  returned 410.
- The isolated authenticated server returned 401 without its fixture cookie.
  An authenticated range request returned 206 and exactly the requested bytes.
- Fresh headless Chromium at 390×844 mounted zero players before Open recording.
  Playback advanced to 0.780911 seconds and seeking reached 2 seconds without a
  media error. `preload=none` remained intact and the page had no horizontal
  overflow. The screenshot was opened and inspected; controls and the transcript
  remained visible. The owned browser session and server were closed.
- Biome passed with existing warnings. The resolution has no conflict markers.
  Diff whitespace warnings are unchanged historical Markdown hard breaks in
  inherited reports. Build and type checking also passed in the commit hooks.

## Commands and receipts

Evidence directory: `/Users/jappy/.cyrus/factory/evidence/manual-30032642-7584-4d54-9ff6-0baa919d6148` (`E`).

- `pnpm build`: `E/ci-execution-integration-build.log`.
- `env -u BOBS_FACTORY_INTERNAL_EXECUTABLE GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false F1_AGENT_MODE=mock pnpm --filter bobs-factory-edge-worker exec vitest run test/Video.test.ts test/FactoryExecution.test.ts test/ExecutionProfiles.test.ts test/WorkflowRuntime.test.ts test/EdgeWorker.capture-recovery.test.ts test/Guide.test.ts test/ReviewModel.test.ts test/ReviewFiles.test.ts test/FactoryReviewState.test.ts test/FactoryReviewFeedback.test.ts test/FactoryPwa.test.ts test/FactoryWebClient.test.ts test/FactoryReviewContext.test.ts test/Incremental.test.ts test/FactoryPipeline.test.ts test/FactoryServer.test.ts test/FactoryAccess.test.ts test/prompt-assembly.routing-context.test.ts`:
  `E/ci-execution-integration-tests-isolated.log`.
- `env -u BOBS_FACTORY_INTERNAL_EXECUTABLE F1_AGENT_MODE=mock bun run E/ci-execution-integration/video-replay-drive.ts`:
  `video-replay.log` and `video-replay-receipt.json` in that directory.
- `F1_AGENT_MODE=mock bun run E/ci-execution-integration/browser-server.ts`.
- `agent-browser --headed false --session ci-execution-video-20261008 open http://localhost:46931/#/runs/video-drive/review`:
  `browser-playback.json` and `guide-mobile-playback.png` in that directory.
- `pnpm biome ci`: `E/ci-execution-integration-biome.log`.

This replay uses historical authentic media, not fresh recording or a newly
approved walkthrough. Simulated acceptance establishes orchestration; the
separate browser establishes playback. Native Safari/iOS, real-model wording,
native startup diagnosis and live ticket synchronization remain unverified.
The sticky navigation can overlap content; normal scrolling restores access.
Tracking remains runtime-owned: delivered receipts coexist with a backlog ticket
snapshot. New-revision reviews and explicit human approval remain required.

## Initial delivery blocker

The signed merge commit failed after successful hooks: `Couldn't find key in
agent?` and `fatal: failed to write commit object`. Host Git configuration selects
SSH signing, using the Bitwarden SSH agent. No signing settings were changed.
The resolved merge and this report remain staged; HEAD stays `5d624fd8` and no
push occurred. Unlock/load the configured signing key and resume this fixer to
commit, push and verify the GitHub PR head. Required reviews remain pending.

The operator confirmed the agent was unlocked at 09:04 UTC. On resume, fetching
`origin/main` confirmed the same base, with no unstaged changes. All 20 focused
video and full-prompt tests passed again (`E/ci-signing-resume-tests.log`). The
signed commit is retried with the existing signing configuration and normal
commit hooks; its delivery result is recorded in the fixer output.
