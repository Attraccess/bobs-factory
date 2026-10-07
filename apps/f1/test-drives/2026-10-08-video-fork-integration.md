# Video evidence after Bob’s Factory migration

Date: 2026-10-08. PR [#33](https://github.com/Attraccess/bobs-factory/pull/33).
Tested parent `3fd36a90` with `a5ff0910` merged and the resolutions in this commit.
Both changelog histories are preserved. Context snapshot tests now locate the
private input file in both source and binary command argument layouts.

## Applicable behavior and results

The base renames workspace packages, compacts role context and adds CI revision
recovery. The combined runtime must preserve video validation, revision-safe
reuse, historical cleanup and authenticated guide playback.

- 249 affected runtime tests passed, including video, passkey access, guide,
  workflow, review recovery, CI revision recovery and the complete routing prompt.
- Eight context tests passed with binary launch configuration and again with
  source launch configuration. The initial binary-mode execution exposed an
  obsolete argument-position assumption; the corrected isolation test passed.
- An isolated tracker issue and simulated capture/review agents replayed an
  existing real recording through runtime validation. All four linked scenario
  mutations rejected reuse; unrelated-story reuse passed the real gate.
- Persisted startup cleanup removed 200 assets, then the remaining six on the
  second startup. Historical metadata remained intact. Expired media returned 410.
- A real loopback server denied unauthenticated media with 401. A fixture session
  received 206 with the exact requested bytes. A fresh headless browser showed
  sign-in before fixture authorization and lazy recording activation afterward.
- At 390×844, Chromium played the historical 3.4-second Save clip, paused and
  sought to two seconds with readyState 4. Controls, preload=none and the expanded
  transcript remained available. The inspected screenshot is linked below.
- Logout returned 200; the next media range request returned 401. Reload showed
  sign-in and no video elements. The first hand-written logout probe omitted the
  required request header and correctly received 403; the corrected probe passed.
- Frozen installation, build, Biome and dependency audit passed. Biome reports
  18 existing warnings; audit reports no known vulnerabilities.

## Commands and evidence

```sh
pnpm install --frozen-lockfile
pnpm build
F1_AGENT_MODE=mock pnpm --filter bobs-factory-edge-worker exec vitest run test/Video.test.ts test/FactoryAccess.test.ts test/FactoryAuth.test.ts test/FactoryPipeline.test.ts test/FactoryReviewFeedback.test.ts test/FactoryReviewContext.test.ts test/FactoryReviewState.test.ts test/WorkflowRuntime.test.ts test/Guide.test.ts test/FactoryServer.test.ts test/Incremental.test.ts test/prompt-assembly.routing-context.test.ts
pnpm --filter bobs-factory-mcp-tools exec vitest run src/factoryContext.test.ts
env -u BOBS_FACTORY_INTERNAL_EXECUTABLE pnpm --filter bobs-factory-mcp-tools exec vitest run src/factoryContext.test.ts
F1_AGENT_MODE=mock bun run <evidence-directory>/ci-fork-integration/video-replay-drive.ts
F1_AGENT_MODE=mock bun run <evidence-directory>/ci-fork-integration/browser-server.ts
agent-browser --headed false --session ci-fork-video-919d6148 open http://localhost:46853/#/runs/video-drive/review
pnpm biome ci
pnpm audit
```

Evidence: `/Users/jappy/.cyrus/factory/evidence/manual-30032642-7584-4d54-9ff6-0baa919d6148/ci-fork-integration/`.
It retains the drivers, replay receipt, browser playback/logout results and
[mobile playback screenshot](/Users/jappy/.cyrus/factory/evidence/manual-30032642-7584-4d54-9ff6-0baa919d6148/ci-fork-integration/guide-mobile-playback.png).
The owned browser and server were closed. No provider agents or production
tracker mutations were used; this drive replays historical real recordings and
does not claim fresh recording or a new WebAuthn ceremony.

Native Safari/iOS, real-model wording and native startup diagnosis remain
unverified. Live ticket synchronization remains unverified: delivered lifecycle
receipts coexist with a backlog snapshot. Historical reports are preserved.
The new revision requires pipeline review; prior human approval applies to the
previous head only.
