# Compact guided review and PWA integration

Date: 2026-10-06. PR [#17](https://github.com/Attraccess/bobs-factory/pull/17).
Tested `45c6ac1eb958d78a71d19af0dfb7c8fe78b7a489` with base
`3a98d3bae6b7574ada999d40a99d89e436b2a597` and the merge resolutions.

F1 applies to the interaction between compact review navigation/checks and the
base's tab-local PWA update/feedback restoration. The merge preserves both
features. Two integration defects were corrected: snapshot validation now accepts
bounded review URLs carrying page/revision parameters, and checked steps keep a
review snapshot meaningful after returning to Overview. Progress participates in
the PWA snapshot without changing its exact guide/revision identity. Historical
F1 reports and accepted visual evidence remain retained.

## Setup and scope

Fresh repository `/tmp/factory-review75-pwa-drive`, worker state
`/tmp/factory-review75-pwa-fixture`, UI port 3575, F1 RPC port 3600 and
fixture-control port 3576. The prior scoped fixture was copied with new state/repo
paths; it runs the compiled EdgeWorker, CLI issue tracker/activity sink, real
routing/worktree creation, guide correction, file snapshot and pending human gate.
External guide authorship, screenshot inventory and GitHub operations use
explicit deterministic fixtures. Native installation and production transports
are outside this drive.

```sh
apps/f1/f1 init-test-repo --path /tmp/factory-review75-pwa-drive
node <evidence-directory>/ci-pwa-fixture.mjs
CYRUS_PORT=3600 apps/f1/f1 ping
CYRUS_PORT=3600 apps/f1/f1 create-issue --title 'Compact review PWA merge integration' --description 'Preserve tab-local checks and feedback through an explicit app update; require acknowledgment for changed guide feedback.' --labels workflow:review75
CYRUS_PORT=3600 apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3600 apps/f1/f1 view-session --session-id session-1 --limit 5
agent-browser --session ci-pwa75-fixed open http://127.0.0.1:3575/#/runs/session-1/review
```

A temporary HTML comment produced a coherent baseline shell; the source was
restored and the target assets rebuilt. A graceful fixture restart served the
target while retaining the same pending run/gate. The browser chose **Update now**
through the real PWA control. No production review was answered or approved.

## Results

Fourteen assertions passed, recorded in `ci-pwa-browser-checks.json`:

- Returning to Overview retained a checked chapter step. After shared-storage
  progress was deliberately replaced with a different page/marker, the explicit
  update restored this tab's mounted Overview/check state, including its query URL.
- The additional feedback field and compact Before item comment survived updating.
  Opening the chapter restored its checked step and comment cue.
- Changed files retained the complete immutable manifest and opened a diff for the
  exact saved head. Decide allowed approval with chapters still unreviewed.
- At 390×844 the page width stayed within the viewport. The restored feedback and
  stale-feedback controls were captured and visually inspected.
- A replacement guide/gate reset reading progress to Overview, retained this
  tab's feedback, and disabled submission until explicit acknowledgment. Checked
  steps reset for the replacement guide; the item comment remained available.
- Updating, navigation and acknowledgment submitted no human decision. A further
  gate replacement again displayed the stale warning and disabled feedback.
- The real runtime corrected an initially incomplete guide in the same agent role
  before reaching the gate (two attempts, one correction). Prepare ran once.
  Worker restarts retained the run without repeating completed roles.

The first update reproduction failed because the new query URL was rejected by
the base's snapshot route validator. It passed after correction. Two automation
selectors for the additional-feedback field and one checkbox selector were
corrected using the observed browser references; these were automation failures,
not product failures. All claims above refer to the successful final assets.

## Verification and limits

Root build/typecheck passed. The initial full edge-worker run had 1,195 passing
and 13 failing tests, plus one existing skip: its two asset-dependent suites
started before the newly merged PWA build created `current.json`. After the build,
all 35 tests in those two suites passed. Together this validates all 1,208 tests,
with one existing skip. After the route fix, five focused suites passed 47 tests.
Scoped Biome and diff checks passed; existing CSS warnings are retained.
Repository hooks run root build/typecheck before the merge commit.

Frozen-lockfile installation succeeded. Audit reports three high and one critical
advisory, matching the inherited base's recorded `node-forge`, `braces`,
`source-map-js` and `proxy-addr` findings. This merge adds no dependencies beyond
those already accepted on main and does not claim a clean security audit.

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-26972218-5a1c-4005-ac60-269687696365`.
Fixture, browser scripts, build/test logs, audit and runtime receipts remain there.
Screenshots: `ci-pwa-restored-feedback-mobile.png` and
`ci-pwa-stale-feedback-controls-mobile.png`. The drive remains scoped to this
integration and does not repeat historical native-installation or full-guide
visual acceptance. Its session/worker/browser are stopped after verification.
