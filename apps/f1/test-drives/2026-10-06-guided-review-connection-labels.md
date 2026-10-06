# Guided review connection labels — Taskbot #75, review round 2

Date: 2026-10-06. Tested `d9558c2cdd734d222e9c481062bfe5047c44fea7`
plus this commit's connection-label fix for `review-map-label-overflow`.
Prior file isolation, history, chapter colour and component-label fixes remain
settled; this drive exercises the newly reported connection-label clipping.

F1 applies to the changed factory presentation. The isolated compiled EdgeWorker
fixture was restarted with rebuilt web assets: home
`/tmp/factory-review75-fixes-fixture`, repository
`/tmp/factory-review75-fixes-drive`, F1 RPC 3600, UI 3575, controls 3576.
The existing pending session-1 gate was retained. Deterministic guide responses
were extended with the reviewer's 47/48-character old/new connection labels;
the actual runtime API and factory review page rendered the guide. No native
authoring, remote provider decisions or merge behavior was exercised.

## Validation

- `apps/f1/f1 ping` and `status` pass. The run remains waiting at the same
  pending gate, with no human decisions recorded.
- Both exact reviewer reproductions were bundled from the current SystemMap
  source and stylesheet. The realistic 12-line label now begins at SVG y=57
  instead of -12, with height 180 inside the 268px canvas. The 19-line wide-glyph
  example also fits entirely inside the canvas.
- Twenty Chromium geometry assertions pass: both reproductions in diff,
  before-only, after-only and components-only states, plus the actual factory
  page in each state at 1280px light, 360px dark and 430px light. Assertions
  check text stays inside the SVG, connection labels do not overlap one another,
  lane headings or component boxes, and mobile pages have no horizontal overflow.
  The runtime fixture also retains the previous long lane and component labels.
- Desktop and mobile screenshots were inspected. Served JavaScript and CSS
  match the tested build byte-for-byte.
- All 18 existing focused tests pass across ReviewModel, FactoryReviewState,
  ReviewFiles and FactoryWebClient. Root build, typecheck, lint and
  `git diff --check` pass; lint reports existing warnings.

Commands: rebuild with `pnpm build`; start `bun run fixes-round2-fixture.mjs`;
apply `/fixes?id=session-1` and `/round2?id=session-1` on the fixture controls;
run `node fixes-round2-browser.mjs`. Supporting scripts, geometry results,
runtime state, source fingerprint and screenshots are retained in
`/Users/jappy/.cyrus/factory/evidence/manual-26972218-5a1c-4005-ac60-269687696365`
with the `fixes-round2-` prefix. The isolated worker/browser are stopped after
validation; historical reports are preserved.
