# Guided review and pinned changed files — Taskbot #75

Date: 2026-10-06. Tested `a5f5dcd81fa3125eb05cc835f1e84781a5cd5b5d` plus the uncommitted implementation on `factory/manual-26972218-5a1c-4005-ac60-269687696365`. Implementation only: no commit, push, PR creation, merge or publishing.

## Applicability and fixture

F1 applies to guide generation, runtime snapshots, review presentation and persisted review interactions. The drive used the compiled EdgeWorker, CLI issue tracker, LinearActivitySink, real Git worktrees, dashboard APIs, SSE, output correction and human decision validation. Guide candidates, CI/PR receipts and provider responses were deterministic. No native guide model or remote PR/merge was exercised. Early fixture runs also started the existing background title agent; later restarts disabled it to keep the drive isolated and deterministic.

Fresh repository: `/tmp/factory-review75-drive`. Worker home: `/tmp/factory-review75-fixture`. UI: 3575; F1 RPC: 3600; fixture controls: 3576. The fixture uses an eligible `review75` workflow label and the real issue/session launch path. Its prepare step commits source, shared code, a 620-line test and documentation; the guide step calls the production validation/finalization seams through the actual bounded correction loop. Human review waits on the real committed SHA. Screenshot evidence is a screenshot of the fixture dashboard, not evidence of an external product. One intentionally missing image exercises failures.

```sh
pnpm --filter cyrus-f1 build
apps/f1/f1 init-test-repo --path /tmp/factory-review75-drive
node /tmp/factory-review75-worker.mjs
CYRUS_PORT=3600 apps/f1/f1 ping
CYRUS_PORT=3600 apps/f1/f1 create-issue --title 'Review compact guide fixture snapshots and reading checks' --description 'Exercise guided review and revision snapshots.' --labels 'workflow:review75'
CYRUS_PORT=3600 apps/f1/f1 start-session --issue-id issue-2
agent-browser --session review75 open http://127.0.0.1:3575
```

DEF-1/session-1 initially failed because the fixture did not claim the actual generated `.claude/settings.local.json` file. The existing whole-PR coverage guard correctly rejected it. The fixture was corrected to claim all remaining scope files, without weakening validation. DEF-2/session-2 and DEF-3/session-3 completed prepare, guide and human-review handoff. Routing/initial activities and history were retained through the real tracker/runtime paths.

## Generation, revision and decision assertions

- Session-2 deliberately omitted chapter 0 `tldr`. Validation rejected the complete candidate with its JSON Pointer and required-field expectation. The same guide role corrected it: prepare ran once, guide attempted twice with one correction, and human review ran once. No capture or implementation rerun was needed. The correction receipt is retained.
- The successful guide received a runtime-owned whole-PR snapshot with complete six-file inventory. Per-file patches remain outside the dashboard payload. Session-2 head: `4d86526775593843c3a3fac8138d35c3015a6ba6`; session-3 head: `8c2ff0b2abe2624ae966c1f9565c2ac2658dccfc`.
- Replacing session-2's guide/gate while keeping its Git head reset the browser reader to Overview, cleared chapter/check progress for the new identity and displayed the revision notice. A stale gate submission returned HTTP 409. Reloads and graceful worker restarts preserved the pending matching gate, guide snapshot and empty decision history.
- Navigation, checkboxes, images, files, disclosures and SSE events left human decisions empty. At Decide all four chapters were explicitly unreviewed, yet Approve this PR was enabled. A deliberate browser click recorded exactly one approval for gate `13ae34df-8f30-483d-9e11-01f7df961a5e` and session-2's real head. The fixture workflow completed. This is not evidence of a GitHub merge or production settling behavior.
- Completed-run reading still opened the original saved file patches. Historical reconstruction, exact retained receipts, cache reuse after worktree removal, unavailable commits, foreign-run/snapshot rejection, symlink rejection, partial staging and immutable bytes after branch advancement were verified by the Git/API tests.

## Browser assertions

Chromium via `agent-browser`; desktop 1440×1000 and mobile widths 360, 390 and 430. Presentation-only legacy, unassigned and 20-chapter mutations intentionally bypass generation validation, to exercise compatibility/fallback rendering.

- Shared artifact and dedicated readers expose Overview → chapters → Changed files → Decide. Compact text, complete More detail, mixed/visual/logic/supporting chapters, one-open flow stages and Where disclosure render correctly. Utility pages use a neutral top border; chapter colors remain consistent across navigation, cards and groups.
- Independent Before/After map controls render merged, before-only, after-only and components-only modes. Directed edges, removed/added text cues and highlighted parts remain visible. The wide map scrolls inside its own frame without page overflow.
- Forward chapter navigation marks only that chapter reviewed; jumps/back do not. Independent checks survive reload. Explicit page URLs, reload and browser Back/Forward restore the selected page. Harmless SSE updates preserve current heading nodes, scroll, focus and state.
- A 20-chapter guide provides a 23-option mobile page selector and reaches chapter 20 with no horizontal page overflow. Denied Storage get/set calls do not prevent loading or navigation. Legacy chapters omit absent short comparisons, structured checks and invented risk; full original content remains expandable.
- Carousel buttons/dots and image arrows work. Missing images display a local placeholder. Synthetic browser TouchEvents for a horizontal swipe changed image 1 to image 2; a predominantly vertical gesture retained image 2. These events test listener behavior, not physical-device scrolling.
- Image and file dialogs contain focus, preserve the chapter page and restore focus to their trigger. In the nested artifact/image case, Escape closes only the image, then the artifact, restoring each trigger in order. Reader navigation keys are ignored while dialogs are open.
- Changed files shows unique totals, shared tags, exclusive-area hints, source/TEST status and compressed folders. An incomplete claim fixture displays an expanded red unassigned group. Desktop Split and mobile Unified render the saved revision. Group-local arrows change files without changing chapters. The 620-line test initially renders 500 rows, then reveals all 627 available patch rows including metadata.
- Aborting a patch request showed Retry file locally; removing interception and retrying returned the correct 500-row preview. A forced artifact fingerprint mismatch displayed a loading error with no reader or approval control; retry after removing the wrong response loaded the matching guide.
- A separate real temporary Git repository produced a complete immutable 300-file manifest, with +300/−0. Browser response injection of that manifest into Changed files displayed all 300 rows and the compressed folder without mobile overflow. This presentation fixture does not establish run authorization; that binding is covered by the server tests.
- Light/dark, reduced motion, wrapped labels and all tested mobile widths were checked. Axe scans of overview, mixed/visual/supporting chapters, long guide, decision and diff samples report zero violations for their selected WCAG A/AA rules after fixing review-link and chapter-accent contrast. Gradient/non-text cases remain marked incomplete by axe; scans are not a full accessibility certification.

## Checks and evidence

- `pnpm install --frozen-lockfile`: passed; lockfile unchanged, no dependency changes.
- Focused guide/state/server/client/pipeline/incremental/runtime and new Git/model tests passed. Existing capture-recovery fixtures were updated to the mandatory new generated-guide contract.
- `pnpm --filter cyrus-edge-worker test:run`: 100 files passed; 1121 tests passed, one skipped.
- Root `pnpm typecheck` and `pnpm build`: passed. Final presentation-only color/border changes also passed the edge-worker build and `node packages/edge-worker/scripts/build-factory-web.mjs`.
- Biome on changed files: no errors, 15 CSS warnings (existing specificity/important rules plus specificity warnings in the added styles). `git diff --check`: passed.
- Served JavaScript/CSS were compared byte-for-byte with the final build. Compact source and bundle digests are retained in `implementation-source-fingerprint.json`; no production process was restarted.

Evidence directory: `/Users/jappy/.cyrus/factory/evidence/manual-26972218-5a1c-4005-ac60-269687696365`.

Saved and visually inspected implementation screenshots include desktop overview/logic/legacy, mobile visual/changed files/unified diff, light/dark Decide, unassigned files, 20 chapters and 300 files. These are implementation captures; the 27 supplied prototype images were only references. Runtime before-restart, stale decision, pre-decision and final receipts, the fixture/correction, successful check logs and axe outputs are retained alongside images.

## Limits and cleanup

Native guide writing, remote provider checks/merge, physical devices and every possible diagram layout were not exercised. Snapshot binary/rename/mode/bounded-out behavior and exact historical access were verified in Git/API tests rather than a remote PR. No unrelated full monorepo test suite or production gate mutation was performed. Existing approval, capture selection, routing and workflow-selection behavior was preserved. Historical drive reports remain unchanged.

The isolated worker and this drive's browser session were stopped after saving evidence. Temporary fixture repositories/homes remain available for reproduction; their runtime state retains the completed approval and the separate pending presentation fixture.
