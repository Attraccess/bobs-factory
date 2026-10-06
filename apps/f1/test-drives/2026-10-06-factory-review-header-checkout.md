# Review Guide header links and checkout copying

Date: 2026-10-06. Tested `381c85c5ad5d758b98ba0042bdfbc342722e586a` plus the uncommitted Review Guide header implementation. Final served UI build: `eb9867efb111ddc2cfa71508`.

## Applicability and fixture

F1 applies to the changed factory review presentation and browser interactions. This drive used the compiled EdgeWorker, real CLI issue tracker, isolated worktree, dashboard API, SSE and a real pending human-review gate. Guide content, PR/branch receipts and reference variants are deterministic fixtures. No remote provider, checkout command or production ticket was executed.

Fresh repository: `/tmp/factory-header-drive`. Isolated worker home: `/tmp/factory-header-fixture`. UI: 3593; F1 RPC: 3600; fixture controls: 3594. The custom `review-header` workflow allows ticket assignments and manual launches. It emits a legacy-compatible guide, then enters human review. Title generation is disabled in this fixture; the displayed title remains `session-1`. Screenshot references inside the fixture guide are deliberately unavailable and do not establish image/provider behavior.

Commands:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
apps/f1/f1 init-test-repo --path /tmp/factory-header-drive
node <evidence-directory>/f1-header-fixture.mjs
CYRUS_PORT=3600 apps/f1/f1 ping
CYRUS_PORT=3600 apps/f1/f1 create-issue --title 'Review header links and checkout' --description 'Fixture test of header metadata and browser-local copy commands.' --labels 'workflow:review-header'
CYRUS_PORT=3600 apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3600 apps/f1/f1 view-session --session-id session-1 --limit 8
agent-browser --session factory-header open 'http://127.0.0.1:3593/#/runs/session-1/review'
node <evidence-directory>/browser-header-checks.mjs
```

DEF-1/session-1 routed to the isolated repository and workflow. CLI activities retained readable initial and routing messages. Runtime history contains `guide` and `human-review`; the pending gate uses the fixture worktree's actual SHA. The worker was gracefully restarted after the clipboard-focus fix to serve the final assets. Synthetic ticket references were removed before restart/cleanup to avoid provider tracking calls. The pending gate and history survived restart.

## Browser results

39 assertions passed through `agent-browser` and Chromium, at 1440×1000, 390×844 and 320×720 logical pixels.

- PR, encoded branch-tree and originating native-ticket destinations match the dashboard metadata exactly. Links use `_blank` with `noopener noreferrer`. Repository context and the reviewed SHA remain visible.
- Both menu actions submit their displayed command exactly to native `navigator.clipboard.writeText`, which resolves successfully. Single-quote shell escaping is also validated by a focused unit test that passes the adversarial argument to `printf`, without running checkout operations.
- Injected clipboard rejection and an unavailable clipboard expose the exact selectable command, focus the text field and produce no success announcement. Successful retry removes the fallback. The first drive caught Radix restoring trigger focus after fallback selection; the implementation now handles that close-focus event, and the final browser check passes.
- Enter opens the dropdown, ArrowDown selects the second option, and Escape closes it and restores trigger focus. An open dropdown retains its focus during a harmless real SSE update.
- A real runtime event and dashboard refresh retain the same chapter/input nodes, chapter identity, checkbox, unsent feedback, focus and scroll position.
- Native and Taskbot reference variants use the exact supplied reference URL, including a different Taskbot instance/project. PR-only and branch-only runs expose only their supported menu action. Ticketless, absent/legacy metadata and guide-less runs remain usable. Explicit cross-repository metadata does not create a guessed branch-tree link.
- Light/dark themes render correctly. Header links and the copy trigger meet 44px touch targets. Normal and long adversarial branch names do not overflow at 390px or 320px; dropdowns fit the mobile viewport.
- Copying remains usable while the browser is offline with metadata already loaded.
- Before/after API receipts confirm identical workflow history, review gate, human decisions and ticket synchronization receipts. Reading, linking and copying record no approval or workflow rerun.

## Checks and evidence

- `pnpm install --frozen-lockfile`: passed; dependency manifests and lockfile unchanged.
- `pnpm --filter cyrus-edge-worker test:run test/FactoryReviewContext.test.ts test/FactoryReviewState.test.ts test/FactoryReviewFeedback.test.ts test/FactoryWebClient.test.ts`: 31 tests passed in four files.
- Root `pnpm build` and `pnpm typecheck`: passed. The final focus adjustment also passed `pnpm --filter cyrus-edge-worker typecheck` and `pnpm --filter cyrus-edge-worker build`, including web assets.
- Changed-file Biome checks: passed without errors; the stylesheet retains specificity/important-style warnings. `git diff --check`: passed.
- Browser error collection after the drive contained no app errors.

Evidence directory: `/Users/jappy/.cyrus/factory/evidence/manual-443dc98d-6c88-43b6-a340-3b930a4dce9e`.

Saved and visually inspected: `header-desktop-light.png`, `header-desktop-dark.png`, `checkout-desktop-light.png`, `header-mobile-light.png`, `header-mobile-dark.png`, `checkout-mobile-dark.png`, `checkout-long-mobile-light.png` and `clipboard-fallback-desktop.png`. Assertions, compact build provenance and runtime receipts are in `browser-assertions.json`, `provenance.json`, `runtime-before.json` and `runtime-after.json`. Fixture and browser scripts are retained for reproduction. The corrected complete script includes the browser checks; the remaining-checks script records continuation after test-harness fixes for unsupported focus lookup and DOM-object serialization.

## Limits and cleanup

Chromium emulation does not establish physical-device behavior. Exact clipboard arguments were captured after successful native writes; Chromium denied clipboard reads, so host clipboard contents were not inspected. Failure/unavailability were injected browser fixtures. Metadata variants do not prove real provider verification, fork checkout or merge execution. The fixture tracker's existing lack of an `in_review` state is retained in its synchronization receipt; no production ticket synchronization is claimed.

The isolated session was stopped without submitting a human decision. The named browser session and worker were stopped. Test repositories and evidence remain for reproduction. Historical F1 reports are unchanged. No PR was created; the delivery step will add the eventual PR link to the Unreleased changelog entry.
