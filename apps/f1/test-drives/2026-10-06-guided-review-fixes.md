# Guided review fixes — Taskbot #75

Date: 2026-10-06. Tested `d5e1ca5fedab8cb8fb34d5dbdce69b5208e2430b` plus the fixes in this commit. Scope: the four open review findings, without changing decision behavior.

F1 applies to persisted review interactions and factory presentation. This drive reused the isolated compiled EdgeWorker fixture from the original guided-review drive for presentation, then launched a fresh issue in `/tmp/factory-review75-fixes-drive` with home `/tmp/factory-review75-fixes-fixture`. UI: 3575; F1 RPC: 3600; fixture controls: 3576. Guide/provider responses and PR/CI receipts were deterministic; real worktrees, output correction, snapshots, tracker routing activities, APIs and the pending review gate were exercised. No native guide model or remote merge was exercised.

## Results

- **review-files-001:** A new temporary-Git regression confirms each patch has exactly one file entry across both file/folder replacement directions and a rename into the old path's descendant. Glob metacharacters, Unicode and leading punctuation remain literal. Existing immutable snapshot/API tests also pass.
- **review-navigation-history:** Open the bare review URL, Start, browser Back: Overview returns, the address has no page parameter, and its heading receives focus. Forward restores the chapter; reload preserves the explicit chapter. This passed for the retained presentation fixture and the fresh pending run.
- **review-map-chapter-color:** Keyboard focus and hover select chapter-specific outlines. The first chapter's two boxes and connecting edge match its computed chapter colour; hovering another chapter changes to that chapter's colour.
- **review-map-label-overflow:** The reported 53-character lane heading and 59-character part label fit without overlap. A 60-character wide-glyph label also fits. SVG bounding-box assertions show every part label contained in its box and no lane/edge label overlapping a box in diff, before, after and components-only modes.
- Four focused suites pass: 18 tests (`ReviewFiles`, `ReviewModel`, `FactoryReviewState`, `FactoryWebClient`). Biome and `git diff --check` pass. Edge-worker/web build passes; commit hooks require the root build and typecheck.
- Fourteen Chromium assertions pass, including 360/390/430px light/dark layouts without horizontal page overflow. Desktop and mobile captures were visually inspected.
- Fresh launch: `create-issue` with `workflow:review75`, then `start-session --issue-id issue-1`. Session-1 reaches the matching pending gate after one incomplete-guide correction. Tracker routing/start activities are visible. Navigation leaves human decisions empty.

Evidence: `/Users/jappy/.cyrus/factory/evidence/manual-26972218-5a1c-4005-ac60-269687696365/fixes-browser-checks.json`, `fixes-fresh-runtime.json`, `fixes-fixture.mjs`, `fixes-source-fingerprint.json`, `fixes-map-desktop.png` and `fixes-map-mobile.png`. Served JavaScript/CSS match the tested build byte-for-byte. The screenshot fixture deliberately uses long labels; it is not native authoring evidence. A retained presentation-only guide lacks its original file-snapshot association, so its file count is honestly unavailable; the fresh run creates its snapshot normally.

The isolated workers/browser are stopped after saving evidence; temporary homes/repos remain for reproduction. Historical test-drive reports are unchanged.
