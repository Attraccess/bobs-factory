# Explicit unchecked review progress through app updates

Date: 2026-10-06. PR [#17](https://github.com/Attraccess/bobs-factory/pull/17).
Tested `ce523bcee36506c486ccdab0a99bbe6e1eb41cc5` with the pending
`integration-unchecked-progress-snapshot` fix. F1 applies to persisted review
interactions across the explicit PWA update flow.

## Setup and scenario

Fresh repository `/tmp/factory-review75-unchecked-drive`, worker state
`/tmp/factory-review75-unchecked-fixture`, UI port 3575, RPC port 3600 and
fixture-control port 3576. Reused the prior integration fixture with fresh paths:
compiled EdgeWorker, CLI issue tracker/activity sink, actual routing/worktree,
guide validation and reviewed-file snapshot. Guide authorship, screenshots and
GitHub operations are deterministic fixtures; no production gate was used.

```sh
apps/f1/f1 init-test-repo --path /tmp/factory-review75-unchecked-drive
node <evidence-directory>/unchecked-fixture.mjs
CYRUS_PORT=3600 apps/f1/f1 ping
CYRUS_PORT=3600 apps/f1/f1 create-issue --title 'Explicit unchecked review progress survives update' --description 'Exercise two browser tabs with opposing check state and preserve the updating tab’s unchecked state.' --labels workflow:review75
CYRUS_PORT=3600 apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3600 apps/f1/f1 view-session --session-id session-1 --limit 5
agent-browser --session unchecked75 open 'http://127.0.0.1:3575/#/runs/session-1/review?page=chapter%3Afeature-0'
```

Both baseline and target shells include the fix. A temporary HTML comment created
baseline build `518c7c0150e92549d647e21e`; restoring the original HTML produced
target build `9691e9f6bcabe31ea96c1ab3`. The worker restarted gracefully to serve
the target while retaining the pending run. This validates the corrected updater,
not retroactive repair of snapshots already dropped by an older updater.

Tab A opened the first chapter directly, checked then unchecked its first check,
and returned to Overview. Tab B opened the same chapter and checked it. Shared
local storage held Tab B's `checked=true` and chapter page while Tab A still
displayed Overview. Tab A chose the real **Update now** control.

## Results

Nine browser/runtime assertions passed:

- Update restored Tab A's Overview URL and removed the update notice.
- Its explicit `checked=false` replaced the other tab's shared checked value.
- Empty reviewed markers and both visited page markers survived.
- The consumed update snapshot was removed from session storage.
- Opening the chapter rendered the check unchecked; ordinary reload kept it so.
- The 390×844 layout remained within the viewport. The mobile screenshot shows
  the unchecked check and reviewed controls with usable sticky navigation.
- Update and navigation submitted no human decision; the gate remained pending.

The fixture's restarted runtime retained completed prepare/guide/human-review
history without rerunning those roles. F1 ping, issue/session creation and activity
retrieval succeeded. Session stop, worker shutdown and browser cleanup succeeded.

The first tab-selection command used a positional index; the installed browser
CLI required the observed stable tab ID `t1`. A transient Retry connection control
disappeared as reconnection completed; a fresh snapshot identified Update now.
These automation corrections did not change the product or test scenario.

Focused PWA/progress suites passed 32 tests, including explicit false entries,
visited-only progress and pruning of empty default progress. Scoped Biome and
diff checks passed. Repository commit hooks run root build and typecheck.

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-26972218-5a1c-4005-ac60-269687696365`.
Files: `unchecked-fixture.mjs`, `unchecked-browser.mjs`,
`unchecked-browser-checks.json`, `unchecked-runtime.json`, fixture logs and
`unchecked-restored-mobile.png` (visually inspected). Historical reports and
accepted screenshots are preserved. Native installation and provider authoring
remain outside this focused drive.
