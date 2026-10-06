# Collect feedback throughout the review guide — Taskbot #70

Date: 2026-10-06. Tested `23d5578016175e6794e6150fbbaaceffe707cf2a` plus the uncommitted #70 implementation on `factory/manual-1ab8010c-0503-48fc-bdd8-92558d3f43d6`.

## Applicability and setup

F1 applies to persisted human-review interactions and the rejection trigger. This drive exercised the compiled EdgeWorker, CLI issue tracker, isolated worktrees, dashboard APIs/SSE, real pending human gates and the workflow's rejection branch. Guide generation and human-fix execution were harmless deterministic fixtures. The human-fix agent hook captured its complete input instead of editing or publishing code.

Repository: `/tmp/factory-review70-drive`; worker home: `/tmp/factory-review70-fixture`. UI port: 3519; F1 RPC: 3600; fixture-control port: 3521. Seven issues/sessions used an explicitly eligible `workflow:review70` definition. The guide has three chapters, before/after text, diagrams, screenshots, risks, checks, long file paths, evidence and acceptance criteria. A 100-entry evidence list exercises the large-artifact reader. One screenshot is an actual fixture-dashboard capture; another is deliberately unavailable.

Representative commands:

```sh
pnpm install --frozen-lockfile
apps/f1/f1 init-test-repo --path /tmp/factory-review70-drive
node /Users/jappy/.cyrus/factory/evidence/manual-1ab8010c-0503-48fc-bdd8-92558d3f43d6/f1-fixture.mjs
CYRUS_PORT=3600 apps/f1/f1 ping
CYRUS_PORT=3600 apps/f1/f1 status
CYRUS_PORT=3600 apps/f1/f1 create-issue --title 'Collect review comments' --description 'Fixture combined feedback review.' --labels 'workflow:review70'
CYRUS_PORT=3600 apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3600 apps/f1/f1 view-session --session-id session-1 --limit 8
agent-browser --session review70 open http://127.0.0.1:3519/#/runs/session-1/review
```

The CLI timeline retained readable initial/routing activities. Runtime history and review decisions were read through the real dashboard and fixture-control APIs. The worker was gracefully restarted after the final web changes; its pending legacy gate survived. Served JS/CSS were checked against the final built assets.

## Browser and workflow assertions

Chromium ran at 1440×1000 and 390×844 logical pixels, using the built dashboard.

- Added early item comments to before text, a screenshot, a diagram step, a review check and a file. Edited through the collected panel and removed a temporary risk comment. Content paths distinguish source-array entries; chapter IDs, screenshot area/state/caption, diagram details and file paths accompany the submitted comments.
- Drafts survived next/jump/back navigation, disclosures and reload. A harmless real SSE event retained the same focused input and scroll coordinates. No decisions or human-fix receipts appeared during editing or reading.
- The collected panel allows editing, removing and returning to a target on another chapter. Returning to hidden file evidence opens the disclosure and focuses the correct target. Only one guide page mounts at a time. Associated image loading, missing-image feedback and external links remain available.
- The final page always has a six-row additional-feedback textarea. Approval remains a separate final-page action. Early pages allow feedback submission without marking chapters reviewed.
- DEF-1 submitted five item comments and multiline general feedback from chapter one. There was exactly one rejection request, one stored decision and one human-fix history entry; the request, decision and human-fix input contained identical feedback. An injected HTTP 409 first retained all drafts.
- DEF-2 and DEF-3 independently exercised item-only and general-only feedback. Each recorded one rejection and delivered its exact message to one human-fix invocation.
- DEF-4 rejected a 100,001-character general draft locally without truncating it. An injected network failure retained both item and general drafts. Replacing its gate/revision isolated the new draft and retained the original storage record. The real API rejected obsolete identifiers with HTTP 409. Loading the matching guide reset reading to Overview, and explicit final-page approval recorded one approval without invoking human-fix.
- DEF-5 exercised legacy before/after guides and migration of an original `{feedback, open}` record. The general draft survived reload; legacy item comments survived navigation.
- DEF-6 delayed the actual rejection request, navigated to Today, then released it. Success cleared the submitted identity after its form unmounted, while DEF-4's earlier unsent draft remained stored. Editing and competing decisions were disabled during pending submissions.
- A separate browser with storage access denied at initialization still supported in-memory item comments across chapter navigation. Reload persistence is intentionally unavailable when the browser denies storage.
- DEF-7 repeated whole-item target coverage, live-update focus, hidden-item navigation and exact combined early submission against the final built assets. The entire expected feedback message matched the one request, decision and human-fix input.
- Light/dark desktop and mobile layouts rendered correctly. Long paths wrapped with no horizontal overflow at 390px. Comment controls measured at least 44px tall. Keyboard focus/Enter exercised comment selection and target navigation.

## Verification and evidence

- `pnpm install --frozen-lockfile`: passed; lockfile unchanged, no dependency changes.
- `pnpm --filter cyrus-edge-worker test:run test/FactoryReviewState.test.ts test/FactoryReviewFeedback.test.ts test/FactoryWebClient.test.ts test/FactoryServer.test.ts test/WorkflowRuntime.test.ts test/Guide.test.ts`: 78 tests passed in six files. Six feedback regressions cover legacy/invalid storage, identity isolation, complete serialization, distinct targets/order, blank filtering and the final length limit. The first API run started before web assets were built; it passed after the build completed.
- `pnpm typecheck` and `pnpm build`: passed, including web types and bundled assets. The final web build and type checks were rerun after historical-revision and saved-target navigation guards changed.
- Biome on changed TypeScript/TSX/tests: passed. CSS: passed with 11 pre-existing specificity/important-style warnings. `git diff --check`: passed.

Evidence directory: `/Users/jappy/.cyrus/factory/evidence/manual-1ab8010c-0503-48fc-bdd8-92558d3f43d6`.

Saved and visually inspected: `early-item-desktop.png`, `collected-desktop.png`, `collected-mobile-dark.png`, `long-path-mobile-light.png`, `additional-desktop-light.png`, `additional-mobile-light.png` and `additional-mobile-dark.png`. Runtime receipts include `before-submit.json`, `combined-rejection.json`, `separate-rejections.json`, `stale-and-approval.json`, `unmounted-success.json`, `final-reading.json`, `final-rejection.json` and `final-runtime.json`. Fixture and browser scripts are retained alongside the receipts. Automation setup errors (unsupported text selectors, a missing protected-API header and a Python quoting error) were corrected before asserting the affected flows; covered elements were exercised with keyboard focus/Enter.

Limits: device sizes are Chromium emulation, not physical-device testing. The guide and human-fix role are fixtures; there is no claim of real guide generation, code fixing, provider merge confirmation or production mutation. Initial fixture issues used the existing background title-naming harness; title naming was suppressed on the fixture restart. This incidental naming does not validate provider behavior. No remote PR was created or merged. Relevant tests and required build/types ran; the full monorepo test suite did not. Historical reports remain unchanged. Isolated pending work and browser/worker sessions were stopped after the drive.
