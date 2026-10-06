# Guided review label collisions — Taskbot #75, review round 3

Date: 2026-10-06. Tested `ce8d837993ccaedc6b41204d14ff0dc203955cce`
plus this commit's fix for `review-map-label-overflow`. The earlier file isolation,
history, chapter-colour, heading/part wrapping and connection-clipping fixes remain
settled. This drive covers the newly reported overlap between adjacent and
self-loop connection labels.

F1 applies to factory presentation. A fresh isolated compiled EdgeWorker used
home `/tmp/factory-review75-round3-fixture` and repository
`/tmp/factory-review75-round3-drive`; F1 RPC 3600, factory UI 3575, fixture controls
3576. An eligible `workflow:review75` issue launched through the actual CLI tracker,
worktree, guide validation/finalization and review-gate paths. Guide responses and
PR/CI receipts were deterministic; native authoring and remote merge behavior
were not exercised.

## Results

- The fixed 130px collision cutoff is replaced by each label's reserved wrapping
  width and height, with spacing. Wide labels are inset from the SVG side edges.
- The exact two-connection reproduction now has label bounds y=57–237 and
  y=321–381, instead of overlapping across y=173–233. The self-loop label also
  begins at x=14 rather than outside the SVG at x=-1.
- Forty-four Chromium geometry checks pass: eight isolated map fixtures in all
  four modes, plus the actual runtime guide in all four modes at 1280px light,
  360px dark and 430px light. Fixtures include both previous clipping examples,
  the exact self-loop case, reversed connection order, nine changed connections
  in both orders, a single lane and a right-hand self-loop. Checks assert that
  headings and connection labels stay inside the SVG and edge labels overlap
  neither one another nor headings/component boxes. Runtime layouts also assert
  no horizontal page overflow and retain the previous long heading/part labels.
- The fresh issue DEF-1/session-1 reaches its matching pending gate after one
  incomplete-guide correction. Tracker routing/start activities are visible.
  Browser map interactions leave human decisions empty and the gate pending.
- All 18 focused tests pass across ReviewModel, FactoryReviewState, ReviewFiles
  and FactoryWebClient. Scoped Biome and diff checks pass. Root lint passes with
  27 existing warnings. Commit hooks run the required root build and typecheck.
- The exact reproduction and desktop/mobile runtime screenshots were inspected.
  Served JavaScript/CSS match the tested compiled assets byte-for-byte.

Commands: `pnpm --filter cyrus-edge-worker build`; focused `test:run` suites;
`apps/f1/f1 init-test-repo --path /tmp/factory-review75-round3-drive`;
`bun run fixes-round3-fixture.mjs`; `apps/f1/f1 ping`, `create-issue` with
`workflow:review75`, `start-session --issue-id issue-1`, `view-session` and `status`;
apply `/fixes`, `/round2` and `/round3` on fixture controls;
`node fixes-round3-map-build.mjs` and `node fixes-round3-browser.mjs`.

Evidence is retained under
`/Users/jappy/.cyrus/factory/evidence/manual-26972218-5a1c-4005-ac60-269687696365`
with the `fixes-round3-` prefix: fixture/source/build scripts, geometry results,
runtime state, compact source fingerprint and screenshots. Temporary homes/repos
remain available. Only this drive's worker/browser are stopped after validation;
historical reports are preserved.
