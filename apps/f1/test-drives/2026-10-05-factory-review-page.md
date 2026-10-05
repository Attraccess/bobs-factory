# Dedicated review-guide page — Taskbot #59

Date: 2026-10-05. Tested `7b9be55260ea7b09aa04b199276cae43f3c30d7d` plus the uncommitted #59 implementation on `factory/manual-a0e3cef0-deb0-47e2-83dd-7dd3cd55a7b2`.

## Applicability and fixture

F1 applies to the changed factory presentation, navigation and persisted human-review interactions. This drive used the compiled EdgeWorker, real CLI issue tracker, real worktrees, dashboard APIs, SSE and revision-bound decision validation. Guide output and provider receipts are deterministic fixtures; no agent or remote PR was invoked.

Fresh repository: `/tmp/factory-review59-drive`. Isolated worker home: `/tmp/factory-review59-fixture`. UI: 3519; F1 RPC: 3600; fixture controls: 3521. The custom two-step workflow emits a 57 KB guide (three feature chapters, diagrams, long disclosure evidence, one associated screenshot and an intentionally missing image), then waits at a real human gate. A second pending review supplies another attention card. DEF-3 tests draft isolation and errors. The associated image is explicitly a screenshot of the fixture dashboard, not evidence of meter hardware behavior.

Commands:

```sh
apps/f1/f1 init-test-repo --path /tmp/factory-review59-drive
node /tmp/factory-review59-worker.mjs
CYRUS_PORT=3600 apps/f1/f1 ping
CYRUS_PORT=3600 apps/f1/f1 create-issue --title 'Review meters and receipts' --description 'Exercise the dedicated guide page with fixture evidence.' --labels 'workflow:review59'
CYRUS_PORT=3600 apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3600 apps/f1/f1 view-session --session-id session-1 --limit 8
agent-browser --session review59 open http://127.0.0.1:3519
```

DEF-1/session-1, DEF-2/session-2 and DEF-3/session-3 routed to the fixture workflow and repository. CLI activity output retained readable initial/routing activities; workflow history and pending gates were visible through the actual dashboard API. The worker was gracefully restarted to load final assets; its pending DEF-3 gate survived. Served JavaScript and CSS were byte-identical to the final built assets. No production worker was restarted.

## Browser assertions

Used `agent-browser` with Chromium at 1440×1000 and 390×844 logical pixels. Native CDP touch dispatch, with touch emulation explicitly enabled, exercised diagonal reading gestures and intentional horizontal Today swipes.

- Today mounts no `GuidedReview`, chapter selector, checklist or approval control. It retains compact summaries, revision/status, Open review guide, run/PR links and Later. The run story and rendered/raw artifact toolbar link to the same dedicated route.
- Direct review navigation and reload work. The dedicated page has no `.focus-deck`. Only one active chapter mounts. Before/after cards, diagrams, captions, lazy images, missing-image messages and exact file-diff anchors remain available.
- Checked a chapter, opened its evidence, entered feedback and scrolled to 2100. A harmless real SSE event retained the same chapter/input nodes, focus, check, disclosure, draft and scroll. Reload restored those values. An offline/reconnect cycle also retained the reader and draft.
- Browser Back/Forward, Escape, Back to Today and header Today restore the reviewed card. Returning through the sticky header and browser Back restored a mobile reading position of 917. Settling the finished fixture run chose a valid remaining card and created no additional human decision.
- Diagonal touch scrolling moved the review page from 491 to 917 without changing the route or run. An intentional horizontal Today swipe changed the selected card. No horizontal overflow at 390px, including a temporarily substituted long file path; before/after cards stack on mobile.
- The artifact inspector restores the same chapter/check/disclosure identity while using separate scroll coordinates. Escape closes it, keeps the run route and returns focus to its trigger. An open theme menu and reader survive SSE; Escape only closes the menu and restores theme-trigger focus.
- Light, dark and system themes work. System dark follows the emulated device preference. Reduced motion disables Bob's animation. The final status button, chapter selector and file links meet the 44px minimum touch target (measured 44/44/44px, or 54px for a wrapped path).
- An unknown run displays an actual API error and retry. Browser response fixtures verify absent-guide, legacy before/after, question, stuck and guide-less Simple presentation. Denied browser storage still allows the guide to load and chapters to change. An injected artifact race rejects a guide whose content differs from the dashboard fingerprint; reader/decision controls remain absent and retry is offered.

## Human decision assertions

Before deliberate submissions, both original runs retained empty human decisions and two workflow history records. Navigation, scrolling, checkmarks and disclosure/draft editing did not approve, regenerate guides or rerun work.

- DEF-1 explicit rejection recorded gate `5e328212-5476-404a-9704-d01e2d58ae23`, SHA `cf8c43572a16a26c58449a85b2fb4fbd91ff35bd`, decision `reject`, and the exact typed receipt-caption feedback.
- A fixture-only replacement of DEF-2's gate/revision invalidated previous decision readiness and visibly announced the update. Approval was disabled for a guide from the old revision, even on Checks & decision. The real API rejected the old gate/SHA with HTTP 409. Loading the matching replacement guide reset the reader to Overview; approval appeared only after explicit decision-page navigation. Explicit approval recorded replacement gate `e5eaff53-b53b-4335-9bc6-5b40f03316ae` and its synthetic replacement SHA.
- DEF-3 retained unsent text after an injected HTTP 409. Replacing its gate presented an empty draft with submission disabled while its old draft remained stored under the old identity. After a matching guide arrived, a real rejection succeeded. Delaying configuration refresh and navigating away during submission verified that the sent draft is cleared even after its form unmounts; the earlier unsent draft remains recoverable.

The fixture workflow ends after a decision. Its completed status does not establish provider merge confirmation; production merge/settling behavior was unchanged. Stock guide-refresh lifecycle remains covered by the focused existing runtime tests; this custom tool-guide fixture does not support guide-only regeneration.

## Checks and evidence

- `pnpm install --frozen-lockfile`: passed, lockfile unchanged.
- `pnpm --filter cyrus-edge-worker test:run test/FactoryWebClient.test.ts test/FactoryReviewState.test.ts test/FactoryServer.test.ts test/WorkflowRuntime.test.ts test/Guide.test.ts`: 67 tests passed in five files, including five new state/identity regressions.
- Root `pnpm build` and `pnpm typecheck`: passed. Final touch-target CSS also passed `node packages/edge-worker/scripts/build-factory-web.mjs` and browser checks.
- Biome on all nine changed TypeScript/TSX/CSS/test files: passed with 13 existing CSS specificity/important-style warnings; no new errors. `git diff --check`: passed.

Evidence directory: `/Users/jappy/.cyrus/factory/evidence/manual-a0e3cef0-deb0-47e2-83dd-7dd3cd55a7b2`.

Saved and visually inspected screenshots: `today-desktop.png`, `chapter-desktop.png`, `chapter-mobile-dark.png`, `evidence-mobile-dark.png`, `decision-desktop-light.png`, `decision-mobile-dark.png`, and `chapter-mobile-light.png`. Additional captures include `today-mobile-dark.png` and `run-entry-desktop.png`. Runtime receipts are in `reading-before-decisions.json`, `rejection.json`, `approval.json` and `final-runtime.json`; the isolated fixture and touch-dispatch scripts are retained alongside them for reproduction.

Limits: Chromium emulation is not physical-device testing. Presentation response fixtures do not prove Simple-run, question or retry backend execution. The guide is deterministic and the replacement SHAs are synthetic. No real-provider merge/queue, native guide generation or production mutation is claimed. Full monorepo tests were not rerun; relevant existing coverage, required build/types and the changed browser flows were exercised. Historical reports remain unchanged. Fixture runs completed, and the isolated worker/browser sessions were stopped after the drive.
