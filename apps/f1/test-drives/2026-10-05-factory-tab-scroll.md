# Run-detail tabs retain their reading position

Date: 2026-10-05. Tested `798c071` plus Taskbot #21 changes.

## Scenario

Fresh F1 repository `/tmp/factory-tabs-drive`, isolated worker home
`/tmp/factory-tabs-fixture`, UI 3487 / RPC 3488. A label-selected script
workflow emits long decision records, a plan and a review guide, then streams
one event every two seconds while waiting for a file gate. Thirty subsequent
steps produce additional artifacts when the gate opens. No external tracker,
GitHub or production session is modified by this fixture.

Commands: `apps/f1/f1 init-test-repo --path /tmp/factory-tabs-drive`, then
`CYRUS_PORT=3488 apps/f1/f1 create-issue --title 'Keep run tabs stable'
--description 'Read every tab while script events stream.' --labels
'workflow:tabs'` and `start-session --issue-id issue-1`. DEF-1 / session-1
exercised issue routing, real workflow script execution, persisted run events,
the dashboard API and browser polling. DEF-2 / session-2 repeated the artifact
append scenario.

## Reproduction and verification

Before the fix, Overview scroll position 310 reset to 0 on the next live event;
the previous detail-body node was disconnected. The entire panel was replaced
for every run change, and ordinary tab scroll positions were not restored.

After the fix, T3 browser checks at 1280 × 800 confirmed:

- Overview retained body scroll 310 and nested input scroll 170.
- Decisions retained nested record scroll 170. Its short outer body had no
  scroll range in this fixture.
- Artifacts retained body scroll 310 and all five expanded panels.
- Review guide retained body scroll 310 and the same content nodes.
- Header, tab bar and body nodes stayed mounted across polling in all tabs.
  Unchanged non-Activity content nodes also stayed mounted.
- Activity retained paused scroll 5191 across streamed messages. Latest resumed
  following (bottom gap 0), and a later paused position 5975 survived switching
  to the guide and back. The guide independently restored position 310.
- At mobile width 390, the page stayed at scroll 1051.5 through live updates,
  and the guide section and navigation nodes remained mounted.
- Opening the DEF-2 completion gate increased artifacts from 5 to 36 and
  changed status to completed. The body stayed at 230, the expanded decision
  record remained open and its nested output stayed at 180. No UI error.

A native T3 recording was captured and a mobile frame inspected. Some T3
navigation/evaluation calls timed out; opening a fresh collaborative tab and
retrying short checks succeeded. No alternate browser was used.

## Other checks and rollout

Ten existing focused Activity/API tests passed, along with JavaScript syntax,
Biome and diff checks. Required workspace build/typecheck and staged hooks
passed. Static dashboard assets are read from disk on request, so rebuilding
and refreshing the page installs this fix without restarting Cyrus. The live
ATT-1127 run remained on the same production process (PID 5560).

Both fixture runs completed; the isolated worker was stopped after validation.
These script fixtures exercise presentation rather than real agent execution;
previous chat and recovery drives retain that evidence.
