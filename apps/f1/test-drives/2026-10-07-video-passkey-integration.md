# Video evidence with Factory passkey access

Date: 2026-10-07. Draft PR [#33](https://github.com/Attraccess/bobs-factory/pull/33).
Tested parent `72b31324` with base `9badbae6` merged and the conflict resolutions
included in this commit. Both changelog entries and the complete video and
passkey capability guidance are retained.

## Applicable behavior

The base adds passkey sessions to the dashboard. Video media, posters and
captions must require a session, including range and HEAD requests. A signed-in
reviewer must still be able to play and seek recordings and read transcripts.
Revocation must deny new media requests and clear the dashboard on reload.

All runtime agents were simulated with `F1_AGENT_MODE=mock` and injected handlers.
The isolated tracker created a fixture issue; no production tracker was changed.
The browser used a fresh explicitly headless named agent-browser session and a
temporary cloned fixture repository/home. A fixture-scoped server session was
seeded; this does not establish a new WebAuthn ceremony or native device behavior.

## Executed results

- 228 affected tests passed across video, authentication/access, server, web
  client, review feedback, PWA, runtime, complete routing prompt, proxy and review
  files. Media/poster/caption GET and HEAD returned 401 without a session.
  Authenticated full/HEAD/range bytes remained correct; revocation returned 401.
- A simulated-agent recording replay rejected all four linked-story mutations
  and accepted unrelated-story reuse through the real video gate. Persisted
  cleanup removed 200 assets on the first startup and the remaining six on the
  second. Historical metadata remained intact; expired authenticated media
  returned 410. This replays historical real recordings, not a fresh capture.
- The real loopback server returned 401 for unauthenticated media and 206 with
  exact requested bytes for a fixture session. Headless Chromium first showed
  the sign-in screen. After fixture authorization, the guide loaded its poster
  and retained lazy activation. At 390×844, playback reached readyState 4, paused
  and sought to two seconds of a 3.4-second historical Save clip. Controls,
  preload=none and the expanded transcript remained available.
- Logout returned 200 and the next range request returned 401. Reload showed
  sign-in and zero video elements. The owned browser session and server closed.
- Frozen dependency installation, audit (zero advisories), build and Biome
  passed. Biome retains 29 existing warnings. Commit hooks cover typecheck.

Commands:

```sh
pnpm install --frozen-lockfile
pnpm audit
F1_AGENT_MODE=mock pnpm --filter cyrus-edge-worker exec vitest run test/Video.test.ts test/FactoryAuth.test.ts test/FactoryAccess.test.ts test/FactoryServer.test.ts test/FactoryWebClient.test.ts test/FactoryReviewFeedback.test.ts test/FactoryPwa.test.ts test/WorkflowRuntime.test.ts test/prompt-assembly.routing-context.test.ts
F1_AGENT_MODE=mock pnpm --filter cyrus-edge-worker exec vitest run test/EgressProxy.test.ts test/ReviewFiles.test.ts
pnpm build
pnpm biome ci
F1_AGENT_MODE=mock bun run <evidence-directory>/ci-passkey-integration/video-replay-drive.ts
F1_AGENT_MODE=mock bun run <evidence-directory>/ci-passkey-integration/browser-server.ts
agent-browser --headed false --session ci-passkey-video-919d6148 open http://localhost:46851/#/runs/video-drive/review
```

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-30032642-7584-4d54-9ff6-0baa919d6148/ci-passkey-integration/`.
It retains both drivers, the replay receipt and inspected desktop/mobile images.
The first access-test edit had a syntax error; the corrected eight-test execution
passed. Biome import ordering was corrected and the final repository check passed.

Native Safari/iOS, real-model wording and native startup diagnosis remain
unverified. Live ticket synchronization remains unverified: delivered lifecycle
receipts coexist with the retained backlog snapshot. Existing sticky-navigation
overlap remains nonblocking; normal scrolling restores access. Historical QA and
recording reports are preserved. Current-revision review and explicit human
approval remain required; the PR remains draft.
