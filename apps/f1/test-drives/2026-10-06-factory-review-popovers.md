# Review-guide comment popovers — Taskbot #70 human feedback

Date: 2026-10-06. Tested `2cf25f54ea3e2b698ca33e5908f9f14ce8072a61` plus the human-feedback changes committed with this report. Historical review-feedback and remount reports remain unchanged.

## Scope and fixture

F1 applies to the changed persisted review interaction and rejection trigger. The rejected inline action rows, editors and previews were replaced with long-press comment popovers and compact count badges. The shared draft format, review identity, API contract and resolved `review-feedback-remount-lock` safeguard remain in place.

Used a fresh `/tmp/factory-review70-popover-drive` repository, worker home `/tmp/factory-review70-popover-fixture`, dashboard port 3519, F1 RPC port 3600 and fixture-control port 3521. The compiled EdgeWorker, CLI tracker, actual worktrees, dashboard APIs/SSE, human gate and rejection branch were exercised. Guide generation and the human-fix agent hook were deterministic fixtures; the latter recorded its exact input. The fixture workflow explicitly allowed manual and ticket-assignment launches and was selected with `workflow:review70`. Repository fetch fell back to local `main` because this isolated repository has no origin.

Commands included:

```sh
apps/f1/f1 init-test-repo --path /tmp/factory-review70-popover-drive
node <evidence>/popover-fixture.mjs
CYRUS_PORT=3600 apps/f1/f1 ping
CYRUS_PORT=3600 apps/f1/f1 create-issue --title 'Popover feedback review' --description 'Validate quiet whole-item comment popovers and collected submission.' --labels 'workflow:review70'
CYRUS_PORT=3600 apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3600 apps/f1/f1 view-session --session-id session-1 --limit 8
agent-browser --session popover70 open http://127.0.0.1:3519/#/runs/session-1/review
python3 <evidence>/popover-drive.py
python3 <evidence>/popover-continued.py
```

The drive was continued after correcting CLI coordinate rounding, gesture-command delays, selectors and Python/JavaScript quoting. These setup errors were not counted as passing assertions. Browser testing also caught release dismissal and lost touch focus; both were fixed and the affected paths retested against rebuilt assets after restarting the fixture server.

## Results

- Desktop holds open the selected whole item's popover; dragging before the threshold cancels the hold. Existing item text does not gain repeated action rows or inline editors.
- Comments were added to before text, a diagram step, screenshot evidence, a review check and a long file path. Each saved item shows a small `1` badge. The accepted draft model still allows one editable comment per item. Badge space prevents text overlap on narrow screens.
- Keyboard activation opens the editor, Escape returns focus to its trigger, and Done/outside presses dismiss it. Popovers retain input focus and scroll position through an unrelated real SSE update. The collected list opens the same popover on the corresponding chapter and focuses its textarea.
- Drafts and badges survived chapter navigation and reload. The final page retained its six-row additional-feedback textarea. A temporary comment was edited/removed through the popover without recording a decision.
- At 390×844, real Chromium touch input through CDP exercised short tap, scrolling drag and hold. Tap/drag left the editor closed; hold kept it open after release and focused the textarea. Light/dark screenshots were visually inspected; the popover fit inside the viewport and the page had no horizontal overflow. This is browser emulation, not physical-device or mobile-keyboard testing.
- An injected HTTP 409 retained all five item drafts and additional feedback. Runtime history and human decisions remained unchanged before explicit submission.
- A separate real pending review loaded available screenshot evidence. Holding the image opened the popover without opening another tab; a normal image click opened its own tab. The original browser disconnected during this supplemental check; it passed in a fresh isolated browser. `popover-screenshot-drive.py` and `popover-image-link-tabs.txt` record this result.
- Submitting from chapter one issued exactly one rejection with 1,856 characters of combined feedback. The request, stored human decision and human-fix input matched exactly. The runtime recorded one human-fix invocation. Leaving and returning during the delayed request kept comment controls disabled, preserving the disposition of `review-feedback-remount-lock`. Success cleared the submitted draft identity.

## Checks and evidence

- Six focused files (`FactoryReviewState`, `FactoryReviewFeedback`, `FactoryWebClient`, `FactoryServer`, `WorkflowRuntime`, `Guide`): **82 tests passed**.
- `pnpm typecheck`: **passed**, including web types.
- `pnpm build`: **passed**, including bundled dashboard assets.
- Biome on the three changed TSX/CSS files: **passed**, with 11 existing CSS warnings.
- `git diff --check`: **passed**.

Evidence directory: `/Users/jappy/.cyrus/factory/evidence/manual-1ab8010c-0503-48fc-bdd8-92558d3f43d6`. Receipts: `popover-submitted-draft.json`, `popover-rejection.json`; scripts: `popover-fixture.mjs`, `popover-drive.py`, `popover-continued.py`, `popover-touch.mjs`. Final mobile screenshots: `popover-editor-mobile-light.png`, `popover-badge-mobile-light.png`, `popover-editor-mobile-dark.png`. The previous broad identity-isolation, storage-failure, legacy-guide and approval evidence remains historical coverage; this drive focused on the changed commenting interaction and combined submission.

Final desktop captures `popover-overview-desktop-light.png` and `popover-screenshot-desktop-light.png` were also visually inspected. Both F1 sessions, the worker and the final browser were stopped after the drive.

No real provider execution, production mutation, remote PR creation or merge was performed by the fixture. The full monorepo test suite was not run.
