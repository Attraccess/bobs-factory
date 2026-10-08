# Video and current guide integration

Date: 2026-10-08. Starting PR revision: `e6c0e508115160196737f6028e070c7b7b5199b8`.
Merged base: `58cce00b2ae6a4f2ab2c51f1fdfa8912ba466d6a`.
Checks ran on the resolved, uncommitted merge. Served web build:
`bd4fcabb5d4a1070c28d1bb8`.

This drive checks video evidence after integrating the guide layout and unsent
input reset changes from main. It uses `F1_AGENT_MODE=mock`, injected deterministic
runtime hooks, an isolated CLI issue tracker, replayed authentic video bytes and
a fresh headless Chromium session. No paid provider agents or production tracker
mutations were used. Browser authentication uses a fixture session seeded only
in the isolated home; it does not retest passkey enrollment.

## Results

- Created and fetched the isolated issue; mocked capture and acceptance passed
  real video finalization and the runtime gate.
- All four changes to linked scenario fixtures, preconditions, actions or
  criteria rejected recording reuse. An unrelated story permitted reuse.
- Startup cleanup deleted 200 expired assets, then the remaining six on the next
  startup, preserving historical output metadata. Expired media returned 410.
- The isolated server denied unauthenticated media with 401. Authenticated range
  requests returned 206 and exactly the requested source bytes.
- The browser mounted no player before Open recording. Playback advanced to
  0.908748 seconds; seeking reached 2 seconds without errors. `preload=none`
  remained intact. The recorded fixture is 3.4 seconds long; this is historical
  authentic media replay, not a fresh capture or a newly approved walkthrough.
- At 390×844, the player fit the viewport without page overflow. Transcript and
  screenshot evidence remained available. The selected screenshot was opened
  and visually inspected.
- Chapter pages omit collected feedback. An item comment remained editable;
  the sticky feedback count opened Decide and its collected comment. Reload
  discarded the unsent comment and additional feedback, restoring count zero.
  No feedback was submitted and no approval was granted.
- No unhandled browser errors occurred. The owned browser and server were closed.

## Commands and evidence

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-30032642-7584-4d54-9ff6-0baa919d6148`
(called `E` below).

- `pnpm --filter bobs-factory-edge-worker typecheck`: passed.
- `env -u BOBS_FACTORY_INTERNAL_EXECUTABLE F1_AGENT_MODE=mock pnpm --filter bobs-factory-edge-worker exec vitest run test/Video.test.ts test/Guide.test.ts test/ReviewModel.test.ts test/ReviewFiles.test.ts test/FactoryReviewState.test.ts test/FactoryReviewFeedback.test.ts test/FactoryPwa.test.ts test/FactoryWebClient.test.ts test/FactoryReviewContext.test.ts test/EdgeWorker.capture-recovery.test.ts test/Incremental.test.ts test/FactoryPipeline.test.ts test/FactoryServer.test.ts test/prompt-assembly.routing-context.test.ts`:
  182 tests passed in 14 files. Complete prompt expectations cover both capability
  descriptions. Guide tests retain new map/scope requirements and legacy reading.
- `pnpm biome ci`: passed with existing warnings.
- `pnpm build`: passed.
- `F1_AGENT_MODE=mock bun run E/ci-guide-integration/video-replay-drive.ts`:
  passed; receipt in `video-replay-receipt.json`.
- `F1_AGENT_MODE=mock bun run E/ci-guide-integration/browser-server.ts`:
  isolated server and exact range-byte checks passed.
- `agent-browser --headed false --session ci-guide-video-20261008 open http://localhost:46854/#/runs/video-drive/review`:
  browser checks above passed. Receipts: `browser-playback.json` and
  `browser-feedback-reset.json`. Screenshot: `guide-mobile-playback.png`.
- `git diff --check --cached`: passed.

Simulated acceptance establishes orchestration, not real-agent wording or new
playback review. The separate browser check establishes actual replay playback.
Native Safari/iOS, real-model wording, native startup diagnosis and live ticket
synchronization remain unverified. The existing sticky-control overlap remains:
normal scrolling restored access to the chapter comment button. Supplied tracking
receipts report delivery while the ticket snapshot retains backlog status.
Tracking remains runtime-owned. New-revision reviews and explicit human approval
remain required; the PR stays draft.
