# Guided review authoring and reader: Taskbot 92

Date: 2026-10-08. Starting revision: `a5ff0910395426ae6967d9637cb2b3d873bbed7a`, with the uncommitted implementation in this worktree. Final served web build: `b13abe6ac38f10612bde7a70`.

This drive covers new nonvisual guide requirements and the guided reader changes in [Taskbot 92](https://taskbot.apps.janjaap.de/p/bobs-factory/t/92). It uses `F1_AGENT_MODE=mock`, F1 mock runner injection, the actual compiled EdgeWorker, Factory runtime, output correction, immutable diff snapshots, passkey authentication and a headless Chromium browser. It does not use paid agent providers.

## Setup and scope

The isolated Factory home is `/tmp/review92-f1-KeWlmC`. The fixture repository and worktrees are beneath that home. UI, provider listener and fixture administration use ports 46992, 46991 and 46993. Production runs, workspaces and evidence were read only. The fixture explicitly uses an isolated legacy-capacity directory instead of inspecting or draining production's active pool.

The manual workflow prepares eight synthetic changed files, authors a guide with a frozen custom prompt, then opens a human review gate. Its first guide candidate deliberately omits the required system map. The second candidate receives the runtime's structured correction and supplies a six-lane map and chapter links. Preparation runs once, authoring runs twice, and history reaches `prepare → guide → human-review`. No human decision, merge or provider publication is performed. Counts and correction details are retained in `runtime-before-restart.json`; later server restarts preserve the run and reset process-local counters, which are reported separately.

Passkey enrollment uses the real operator setup route and a CTAP2 virtual authenticator in the fresh headless session. Protected API access is rejected before authentication. No authentication bypass is installed.

## Results

| Behavior | Evidence and result |
| --- | --- |
| Missing nonvisual map | Actual runtime requests one guide-only correction at `/system`; earlier preparation is retained. The pending gate has no decisions. |
| New and historical contracts | Targeted tests reject missing scope, missing maps, invalid chapter links, inconsistent whole-PR scope and a purely visual claim that contradicts accepted nonvisual scope. Historical guides remain readable. |
| Map | Six lanes fit the 1280px desktop card. Both, Before, After and neither modes retain the correct parts, connections and ghosts. Pointer and keyboard route highlighting works. Long wide-glyph labels have no label/box collisions, label/label collisions or out-of-bounds labels. Edge paths are distinct. |
| Reader interaction | Pointer navigation suppresses heading outlines; keyboard navigation retains focus and its visible ring. Reading marks and checkboxes survive reload. Sticky feedback opens Decide and its expanded comment list. Editing works. A simulated HTTP 503 retains the edited comment and additional feedback. |
| File review | Exact retained diffs render split on desktop and unified on mobile. The header contains mode and file navigation controls. At mobile widths, paths use the first row and navigation/PR/close controls share the second row, including long nested paths. Hunk content omits patch preamble. Arrow navigation and Escape focus return work. The 630-line fixture expands beyond the first 500 displayed rows. |
| Evidence and badges | Device context is recovered from accepted metadata, with honest unknown-device fallback covered in unit tests. Missing images and missing patches display local messages while reader/header controls remain usable. Minimum white-glyph contrast across all 20 chapter colors is 7.39:1 in light and 4.89:1 in dark. |
| Responsive and legacy reading | Technical, visual/mixed and mixed/video examples pass six surfaces at 1280×1000 and 390×844 in both themes. There is no page overflow. 360px and 430px checks also pass. A 20-chapter fixture uses the mobile selector. Legacy artifacts without compact fields or maps remain readable. |
| Review identity | Replacing a guide/gate resets reading to Overview. Submitting the old gate identity is rejected and records no decision. Reduced-motion mode disables page animation. |
| Large inventories | The original billing snapshot has 148 unique changed files. A separately identified UI-only fixture adds 400 files, leaving all 548 files accessible and the unassigned group expanded at mobile width. |
| Purely visual presentation | An explicitly synthetic presentation fixture shows eight short overview thumbnails and navigates to their owning chapter. Its ten-image chapter carousel remains complete. |

Browser records contain no unhandled page errors. All three example families have screenshots for overview, logic chapter, visual chapter, expanded file tree, inline diff and Decide. Side-by-side comparisons use the pinned #75 reference images; their original themes, content and sizes are retained on the reference side.

## Reproducible commands and artifacts

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-59420683-e685-49a3-a5d6-3d88fe231648` (called `E` below).

- `pnpm --filter 'bobs-factory-edge-worker^...' build`: workspace prerequisites built successfully.
- `pnpm --filter bobs-factory-edge-worker build`: passed; final web build above.
- `pnpm --filter bobs-factory-f1 build`: passed.
- `pnpm --filter bobs-factory-edge-worker typecheck`: passed.
- `F1_AGENT_MODE=mock pnpm --filter bobs-factory-edge-worker exec vitest run test/Guide.test.ts test/ReviewModel.test.ts test/FactoryReviewState.test.ts test/FactoryReviewFeedback.test.ts test/ReviewFiles.test.ts test/EdgeWorker.capture-recovery.test.ts test/Incremental.test.ts test/FactoryPipeline.test.ts test/FactoryServer.test.ts`: 124 tests passed in nine files (`E/tests-final.log`).
- `pnpm exec biome check` on the 20 changed TypeScript, TSX and CSS files: passed with 17 CSS specificity warnings and no errors (`E/lint-final.log`).
- `git diff --check`: passed.
- `REVIEW92_HOME=/tmp/review92-f1-KeWlmC node E/fixture.mjs`: actual compiled runtime with deterministic F1 runner handlers.
- `agent-browser --headed false --session review92-20261008 open http://localhost:46992`: fresh headless session, closed after the drive.
- `node E/drive.mjs`, `node E/compare.mjs`, `node E/extra.mjs`: completed interaction, comparison and edge-case assertions. Full records are `browser-results.json`, `comparisons-results.json` and `extra-results.json`. Additional checks are in `post-results.json` and `header-results.json`.
- `node E/header-check.mjs`: long-path header controls stay aligned and within the viewport at 360, 390 and 430 pixels.
- `node E/postchecks.mjs`: the zero-comment feedback count opens Decide with an empty list and the additional-feedback field.
- `node E/visual-captures.mjs`: primary visual screenshots include the device badge within the viewport and decoded image evidence.
- `node E/capture-matrix.mjs`, `node E/contacts.mjs`: presentation screenshots and 72 side-by-side comparisons grouped into 12 sheets. `served-provenance.json` records the served build and limitations.

Example screenshots: `technical-desktop-dark-overview.png`, `technical-desktop-dark-diff.png`, `visual-mixed-mobile-light-files.png`, `mixed-video-mobile-dark-visual-evidence.png`. Comparison sheets are in `E/comparisons/`. The `*-visual-evidence.png` views scroll to the primary visual so the screenshot and device badge are visible. Viewport screenshots preserve normal reader scrolling; additional `*-decide-full.png` files include the decision controls farther down the page.

## Provenance and limits

The example runs are read-only copies of `manual-b38ca592-73a3-4ef6-8ead-9a3113e11b55`, `manual-cffae79b-5ed0-4572-945b-493296377408`, `manual-30032642-7584-4d54-9ff6-0baa919d6148` and supplemental `manual-50347929-ffc6-40cc-a0a4-53f774a3076a`. Screenshot bytes are copied from their accepted evidence. New maps and missing short billing fields are purpose-written presentation fixtures, not claims that those historical agents authored them. Some copied runs show the existing revision warning after fixture reimport changes their gate identity; retained drafts keep that warning. Original snapshots are copied where present. The billing worktree was removed, so its exact `e948f412… → 5f9153dd…` diff is reconstructed from retained local repository objects into the isolated evidence directory.

The mixed/video example uses its accepted screenshots of playback. This branch does not implement or validate the separate pending video feature. Simulated authoring proves contract enforcement and recovery, not native-agent writing quality. Physical devices, real provider merges and live agent CLI/API behavior are not exercised.

The ticket snapshot showed Backlog while the runtime tracking receipt reported In Progress with delivered synchronization. Ticket lifecycle synchronization remains runtime-owned; this implementation does not mutate the ticket to reconcile that snapshot difference.
