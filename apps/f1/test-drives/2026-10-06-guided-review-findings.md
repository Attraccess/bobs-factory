# Guided review findings — PR #19

Date: 2026-10-06. Tested `3fb0500634af126482ed82d3a0445f4ca85c3a92` plus the review fixes in this commit.

## Scope and fixture

F1 applies to customized guide execution, reviewed file snapshots and review rendering. The isolated compiled EdgeWorker used the real CLI issue tracker, activity sink, Git worktree, restricted role context, agent output validation/finalization, dashboard file API and human review wait. A deterministic Codex runner returned a complete compact guide; no native model, remote PR, production tracker, approval or merge was exercised.

Fresh repository `/tmp/factory-review-findings-20261006`; worker home `/tmp/factory-review-findings-home-20261006`; UI 3575, F1 RPC 3600, receipt endpoint 3576. The baseline contained `config` as a file and `legacy/old.ts` in a directory. The prepare step replaced them with `config/new.ts` and a `legacy` file, then committed. The customized guide declared `inputs: ["plan", "capture"]`; retained CI receipts remained on the run rather than in the restricted input packet.

```sh
apps/f1/f1 init-test-repo --path /tmp/factory-review-findings-20261006
node /tmp/factory-review-findings-worker.mjs
CYRUS_PORT=3600 apps/f1/f1 ping
CYRUS_PORT=3600 apps/f1/f1 create-issue --title 'Fresh restricted guide run' --description 'Check real runtime binding and all replacement navigation.' --labels 'workflow:review-findings'
CYRUS_PORT=3600 apps/f1/f1 start-session --issue-id issue-2
CYRUS_PORT=3600 apps/f1/f1 view-session --session-id session-2 --limit 8
agent-browser --session review-findings open 'http://127.0.0.1:3575/#/runs/session-2/review?page=files'
```

## Assertions and results

- The final fresh run executed prepare once and the guide runner once, then reached a pending human review gate. Its history was prepare → guide → human-review, with no human decisions or errors.
- The transported context contained only plan/capture as upstream role outputs, plus originating-ticket metadata and progress. It contained no CI output or new history. Runtime progress independently provided all five changed files, including the generated `.claude/settings.local.json`.
- The guide bound snapshot base `6703d3072121a7f30cb6c3aaa9f86aba58a60cce` and head `ea4edc5dfbca262aaae5db929b6084eed905588d`; head exactly matched its human gate. The immutable inventory loaded through the actual dashboard API.
- At 1440×1000, Changed files displayed the deleted `config`, added `config/new.ts`, added `legacy` and deleted `legacy/old.ts` together. Each folder counted only its own descendant, with correct additions/deletions.
- Starting at `config`, Next file reached `config/new.ts`, `legacy` and `legacy/old.ts` in order. The saved patches contained the expected added/deleted lines. Reader location remained `page=files` throughout modal navigation.
- At 390×844, all replacement rows remained accessible with no page overflow (scroll width 390). Next file opened `config/new.ts` as a unified diff for the exact reviewed base/head. Screenshots were saved and visually inspected.
- An earlier fixture run reached the same snapshot/gate and retained it across a worker restart. Initial fixture-only issues were corrected: the deterministic runner gained the dashboard-required `isRunning` method, and restart setup replaced the already-saved fixture recipe instead of adding a duplicate. No product change was needed for these fixture issues. The final fresh run and browser assertions passed afterward.
- Both isolated sessions were stopped; worker and browser were closed. Fixture files remain for reproduction. Production runs and tickets were untouched.

## Checks and evidence

All 165 tests passed across ReviewModel, EdgeWorker capture/guide recovery, Incremental, ReviewFiles, Guide, FactoryPipeline, FactoryServer, FactoryReviewState, TicketTracking and WorkflowRuntime. The 12 capture/guide recovery tests passed again after aligning the restricted-input regression fixture with the actual transport shape. Workspace build/typecheck, changed-file Biome and diff checks passed.

Evidence directory: `/Users/jappy/.cyrus/factory/evidence/manual-df3a6623-c843-44af-8926-fdc200996962`.

Runtime/input receipt: `review-findings-runtime-receipt.json`; fixture: `review-findings-fixture.mjs`; browser diff receipt: `review-findings-browser-check.json`. Screenshots: `review-file-directory-replacements-desktop.png`, `review-file-directory-replacements-mobile.png`, `review-replacement-descendant-diff-mobile.png`. Build, typecheck and focused test logs are retained there.

The targeted drive supplements the prior ticket-tracking evidence. It does not establish native guide authoring, physical-device behavior or external merge behavior. Historical reports remain unchanged.
