# Authentic video evidence in Factory human review

Date: 2026-10-07. Tested implementation based on `04f29693c76edb83e59fae320d38eaaf71cb648a`
with the uncommitted Taskbot #31 changes. No merge or publication was performed.

## Scope and fixture

Video selection, runtime finalization, playback acceptance, guide references,
loopback streaming, provenance/reuse and retention are F1-applicable workflow
behavior. This drive uses the real `WorkflowRuntime`, `FactoryTools` gate and
`FactoryServer` against an isolated Git repository and F1's in-memory
`CLIIssueTrackerService` (seeded issue `issue-1`, “Authentic video evidence”).
It exercises a custom deterministic capture → review → gate → guide → human
checkpoint recipe. Browser interactions, recording, export, media probing,
decoding, hashing and streaming are real. Deterministic role output is used to
avoid an unrelated native-agent run or external PR/tracker writes. Tracker
routing and production ticket synchronization were not changed or exercised.

The application is a local, non-sensitive Save-record fixture on port 3650.
Capture/review receipts are generated only after actual Save execution and
playback inspection. The custom guide declares capture/review/gate inputs;
whole-PR snapshot generation is outside this isolated recipe. The existing
scope guard initially rejected a guide without that explicit fixture setup.
Guide-only retry preserved completed capture, review and gate history.

Local harness and data: `node_modules/.cache/factory-video-drive/`.
The run's isolated source revision at capture was
`32e2368edcf1fbcebdef68b0abb126b71a10e4fb`.

```sh
bun node_modules/.cache/factory-video-drive/drive.ts
agent-browser --headed false --session factory-video-919d open http://127.0.0.1:3650/fixture
agent-browser --session factory-video-919d set viewport 1280 800
agent-browser --session factory-video-919d record start <run-evidence>/video-temp-save-real.mp4
agent-browser --session factory-video-919d click <Save-ref>
agent-browser --session factory-video-919d snapshot
curl -sf http://127.0.0.1:3650/fixture/status
agent-browser --session factory-video-919d record stop
ffmpeg -i <recording> -c:v libx264 -pix_fmt yuv420p -movflags +faststart <run-evidence>/save.mp4
ffmpeg -i <run-evidence>/save.mp4 -frames:v 1 <run-evidence>/poster.png
curl -sf -X POST -H 'x-factory-request: 1' http://127.0.0.1:3650/fixture/run
# Inspect actual playback in the capture inspector before recording acceptance:
curl -sf -X POST -H 'x-factory-request: 1' http://127.0.0.1:3650/fixture/inspected
# After stopping/restarting the owned server, resume its saved human checkpoint:
curl -sf -X POST -H 'x-factory-request: 1' http://127.0.0.1:3650/fixture/run
bun node_modules/.cache/factory-video-drive/assertions.ts
agent-browser --session factory-video-919d close
```

## Assertions and results

- Save execution produced visible `Saved record 42` and the local fixture reported
  `saved:true`. An earlier fixture attempt lacked the protected POST header and
  was replaced with this successful authentic recording before validation.
- The finalized silent MP4 is H.264/yuv420p, **9.2 seconds, 44,729 bytes**, hash
  `21e3e0ae22b996b971c961ef2ff5a122c50fb9ae5eafa09ff575e53877547184`.
  The short real flow was not padded to the normal 30–90 second target.
- Runtime finalized the actual clip, real poster and transcript, then the
  reviewer inspected playback showing the saved confirmation and supplied the
  exact task/hash acceptance receipt. QA and video gates passed. The guide
  referenced that accepted clip and reached explicit human review.
- Opening the inspector fetched only the poster. The guide overview fetched no
  video assets. Media was attached only after “Open recording”; native controls,
  `playsInline` and `preload=none` were verified. Actual playback/seek worked at
  1280×800 and 390×844. The narrow page had no horizontal overflow.
- Transcript access and representative screenshot enlargement worked. Playback
  did not check either review checkbox. Switching chapters removed the player
  and returning showed an unopened recording.
- Full, HEAD, explicit/open/suffix ranges, malformed/multiple/unsatisfiable
  ranges, stale versions, same-size replaced media and missing media were
  exercised by real-media server tests (200/206/416/409/410 as appropriate).
- Restart retained the complete history, media hash and pending human revision,
  without replaying capture/review. A direct-import startup cycle found by the
  assertion harness was fixed by extracting the shared evidence digest.
- An accepted unaffected clip survived a verified documentation-only correction
  and retained its original capture revision. A changed `view.ts` required fresh
  recording; the previous streaming URL returned 409. Dirty/uncertain and
  unexplained changes are also rejected by the focused provenance tests.
- A missing-probe environment rejected a claimed successful clip. Explicit
  optional tooling unavailability retained the behavioral QA results; required
  recording and product failure cannot pass. Waiting evidence survived cleanup.
- Real-media tests also cover excessive duration/size, audio without captions,
  invalid captions/posters, truncated media, external symlinks and expired
  terminal cleanup while retaining metadata.

## Evidence and limitations

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-30032642-7584-4d54-9ff6-0baa919d6148/`.

- `video-inspector-desktop.png`, `video-guide-desktop.png`,
  `video-guide-mobile.png`: inspected visual proof.
- `feature-video-walkthrough.mp4`: authentic **37.47-second** headless walkthrough
  of guide opening, playback, seeking, transcript and screenshot review.
  H.264/yuv420p, 769,218 bytes. Poster and text transcript accompany it.
- `video-drive-assertions.json`: restart, reuse, invalidation, fallback and
  retention assertions. `video-drive.ts` and `video-drive-checks.ts` preserve the
  local harness; copy them back into the documented cache directory to rerun.

Chromium at a narrow viewport is not native Safari/iOS evidence. Native device
access was unavailable, so native playback remains a disclosed coverage gap.
Installed agent-browser/ffmpeg/ffprobe were exercised; the documented Playwright
fallback was not driven. Recorder authenticity depends on real execution receipts
and playback review; media validation alone cannot distinguish a forged slideshow.
The driver stopped before human approval and merge, and closed only its named
browser session and owned server. Binaries remain outside source control.

## Final checks

- `pnpm install --frozen-lockfile`: passed without dependency or lockfile changes.
- `pnpm build` and `pnpm typecheck`: passed across the monorepo.
- Six focused edge-worker suites (Video, FactoryPipeline, FactoryServer, Guide,
  Incremental, WorkflowRuntime): 141 tests passed. After the final retention
  hardening, the affected Video suite passed all 10 tests and edge-worker build
  and typecheck passed again.
- `pnpm --filter cyrus-mcp-tools test:run src/factoryContext.test.ts`: 4 passed.
- Changed-file Biome (19 TypeScript/TSX files) and `git diff --check`: passed.
- The final retention regression also rejects symlinked run directories and
  tolerates dangling temporary links without damaging outside files or startup.

The 37.47-second walkthrough hash is
`877ce27449fcef3bd75bc8822beb69bab7e81dd78bbae70db24e7a56a24057de`.
Changelog PR linkage is left for the publishing role, which owns creating the PR.
