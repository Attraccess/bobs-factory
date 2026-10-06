# Guided review base integration — PR #17

Date: 2026-10-06. Tested `1dad0516bccc6fc9f838a0ab680a8a65ba20353f` plus the merge of `8f3b5f6562a20685889ac81d5fcb0e86da19a439` and its conflict resolutions. This is the CI-fix step: the PR stays draft; no remote merge or approval was performed.

## Scope and setup

F1 applies to the overlap between compact guided review and the base's collected-feedback workflow. Conflicts also combined QA contracts with strict generated-guide validation and retained handoff recovery. Prior file isolation, browser history, chapter colour and map-label fixes remain intact. Historical test-drive reports were preserved.

The drive used a fresh repository `/tmp/factory-review75-ci-drive`, worker home `/tmp/factory-review75-ci-fixture`, the compiled EdgeWorker and real CLI issue tracker, activity sink, worktree, output-correction loop, file snapshot, human gate and rejection branch. Guide authorship, screenshot inventory and the human-fix receipt were deterministic fixtures. No native provider, remote PR or production review gate was exercised.

UI port 3575, F1 RPC 3600, fixture-control port 3576. Launched issue-1/session-1 using the eligible `workflow:review75` fixture. The prepare step committed actual file changes, and the guide role finalized an immutable reviewed-revision snapshot.

```sh
apps/f1/f1 init-test-repo --path /tmp/factory-review75-ci-drive
node /tmp/factory-review75-ci-worker.mjs
CYRUS_PORT=3600 apps/f1/f1 ping
CYRUS_PORT=3600 apps/f1/f1 create-issue --title 'CI merge integration: compact review and collected comments' --description 'Validate saved revision files and item feedback after base integration.' --labels 'workflow:review75'
CYRUS_PORT=3600 apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3600 apps/f1/f1 view-session --session-id session-1 --limit 8
agent-browser --session ci75 open http://127.0.0.1:3575/#/runs/session-1/review
```

## Assertions and results

- The first guide candidate omitted a required chapter summary. The real validation/correction flow rejected it, then the same guide role corrected it. Prepare ran once, guide attempted twice, and the run reached a pending human gate.
- Added four comments: a compact Before phrase, a screenshot, a flow stage and a file in More detail. All retained their item paths and source context. Drafts and current page survived forward navigation and reload; advancing marked only the departing chapter reviewed.
- Collected feedback returned to the hidden file and opened More detail. Browser testing exposed a focus race between URL navigation and the comment editor. The resolution preserves the active editor's focus. The repaired flow passed with final assets.
- Returning to a screenshot comment restored visual mode; returning to a flow comment restored the correct expanded stage. The compact reader still showed one primary visual at a time.
- Changed files retained its complete snapshot inventory, and the selected saved file diff opened without changing the chapter/page.
- Decide allowed explicit approval while other chapters remained unreviewed. Navigation and draft editing left human decisions empty.
- A single explicit feedback submission from chapter one recorded exactly one rejection and invoked the fixture human-fix once. Its receipt exactly matched the stored decision and included all four item comments plus general feedback.
- At 390×844, the page had no horizontal overflow and comment controls measured at least 40px. The mobile collected-feedback screenshot was visually inspected. Desktop was also captured and inspected.
- A graceful worker restart preserved the pending gate, snapshot and browser drafts. The server captures web assets at startup; the final restart served JS byte-for-byte identical to the rebuilt bundle. Earlier browser automation had one selector-quoting error; the corrected assertion was rerun. An initial focus retest used the server's old cached assets and was rerun after the final restart.

## Checks and evidence

- Edge-worker suite: 102 files passed; 1,174 tests passed, one skipped. This suite ran after the primary conflict resolution. A subsequent saved-QA-guide migration regression also passed in the five-test Guide suite, preserving model settings and idempotence.
- Root build and typecheck passed after base integration. The final web focus fix passed the edge-worker build; repository commit hooks also run root build and typecheck.
- Biome on affected files: no errors, 16 CSS warnings. `git diff --check` passed.
- Thirteen browser/runtime assertions are recorded in `ci-merge-browser-checks.json`. Runtime evidence includes the pre-decision, post-decision and exact human-fix feedback receipts. The correction candidate is retained in the isolated fixture home.

Evidence directory: `/Users/jappy/.cyrus/factory/evidence/manual-26972218-5a1c-4005-ac60-269687696365`.

Screenshots: `ci-merge-chapter-desktop.png` and `ci-merge-feedback-mobile.png`. Browser fixture/automation, logs and receipts are retained alongside the evidence or under `/tmp`. This focused drive supplements prior accepted technical/visual/mixed, snapshot and map-geometry validation; it does not repeat every earlier scenario or certify physical-device behavior. Test processes and the drive's browser session were stopped after validation.
