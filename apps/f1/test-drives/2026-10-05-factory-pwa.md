# Factory PWA: safe updates and continued execution

Date: 2026-10-05. Tested base `7b9be55260ea7b09aa04b199276cae43f3c30d7d`
plus the uncommitted Taskbot #41 implementation. Final shell build:
`43cf49d72997c3a9359d04f6`. macOS 26.6.2; agent-browser 0.38.1 with
Chromium/HeadlessChrome 154. Google Chrome 154.0.8037.97 was also checked for
connected rendering and worker registration, without native installation.

## Scope and fixture

F1 applies to dashboard activity, action availability, reconnect and run
continuation. Two isolated built EdgeWorkers used the real CLI tracker, routing,
Git worktrees, FactoryRuntime, checkpoints, activity sink, server and browser.
Only the model call was deterministic: emit 240 cursor-bearing workflow events
and a thought activity, ask one question, then continue after an answer. The
next script waited for a fixture-local release file before completing.

The local test repository has a bare origin; no production runs, remote tickets,
GitHub repositories or Tailscale configuration were changed by these drives.
The first worker used `node_modules/.cache/manual41` (UI 3615, RPC 3616); the
fresh final drive used `node_modules/.cache/manual41-current` (UI 3625, RPC
3626). Each has its own repository, home directory and worktree.

## Assertions and results

- **Issue and session:** F1 `create-issue` returned DEF-1/issue-1;
  `start-session` returned session-1 and created the isolated worktree.
  `view-session --limit 10 --offset 0` displayed timestamped routing/thought
  activities and the clarification response. Pagination with limit 2/offset 2
  returned two of five activities after continuation.
- **Real action:** The current question was filled and submitted once through
  the browser. Factory state changed from waiting/clarify to running/work with
  exactly one answer and two history records. Releasing the script completed
  the same run/workspace with three history records and checkpoint `end`.
  F1 `stop-session` then stopped the tracker session cleanly; `view-session`
  reported complete.
- **Cache boundary:** Browser Cache Storage contained exactly eight static
  shell entries: root HTML, manifest, versioned JS/CSS and four icons. No API,
  SSE, transcript, artifact, raw entry, image response or mutation was cached.
  Built-server inventory contained those eight resources plus the worker, with
  complete manifest/HTML references and 192/512/512/180 PNG dimensions.
- **Disconnected:** A controlled cold navigation at 390 × 844 loaded the shell
  and useful reconnect/retry text without indefinite loading. A loaded run
  retained editable drafts while actions were disabled and data marked stale.
  Reconnecting refreshed authoritative state, re-enabled valid actions and
  preserved the draft and paused reading position.
- **Explicit updates:** With two open tabs, the server's UI snapshot was
  replaced while its worker/run remained running. Later retained the old
  mounted UI. Updating one tab restored launch inputs/recipe selection,
  clarification and chat drafts, route, open step panels, a raw artifact
  inspector, and a paused older activity anchor/cursor beyond the initial
  history page. The other tab retained its own draft and did not reload.
  Old-client caches remained available. Restoration storage was consumed.
  Separate explicit updates preserved an open recipe JSON editor and its
  unsent JSON. Backend state before/after UI updates retained run ID, workspace,
  waiting checkpoint, zero answers and unchanged history: no automatic action.
- **Preservation failure:** Denying `sessionStorage.setItem` postponed Update
  with a visible error, retaining route, draft and inspector; restoring storage
  allowed retry and restored the raw inspector. A separate browser context
  whose `sessionStorage` getter throws rendered the connected app with a warning.
- **Stale state:** Real HTTP requests with an old configuration revision or
  changed question context returned 409 without altering configuration or
  recording an answer. Changing the authoritative fixture recipe while its
  editor was open retained the unsent JSON and disabled Save. Editing did not
  clear the warning; deliberate acknowledgement enabled Save. The draft was
  never saved, and original fixture configuration was restored.

The browser update sequence exercised intermediate candidate builds
`91cdac… → 166ea… → 7a… → 613d66… → 73cdd… → 43cf49…`.
The final fresh drive and cold-offline screenshot used the full final build ID
above. This is runtime provenance, not a claim that every earlier screenshot
was captured from the final build.

## Commands

```sh
bun node_modules/.cache/manual41-current/fixture.mjs
CYRUS_PORT=3626 apps/f1/f1 create-issue --title 'PWA current lifecycle' \
  --description 'Isolated installation/update acceptance fixture' \
  --labels workflow:pwa-probe
CYRUS_PORT=3626 apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3626 apps/f1/f1 view-session --session-id session-1 --limit 10 --offset 0
agent-browser --session manual41fresh open http://127.0.0.1:3625/#/runs/session-1
# Fill the current question and click Send answers once using snapshot refs.
touch node_modules/.cache/manual41-current/release
CYRUS_PORT=3626 apps/f1/f1 stop-session --session-id session-1
CYRUS_PORT=3626 apps/f1/f1 view-session --session-id session-1 --limit 2 --offset 2
```

UI-only snapshot replacement in the first fixture used SIGUSR2 to stop and
recreate FactoryServer on the same runtime. Optional process-restart testing
also retained the waiting run's persisted checkpoint and identity. That fixture's
CLI tracker is in memory and lost its session on process restart, so post-restart
tracker output is **not** passing evidence. The fresh final drive above covers
the complete tracker/activity/action path without that limitation.

## Other checks and limits

- `pnpm install --frozen-lockfile`: passed; no dependency changes.
- `pnpm build` and `pnpm typecheck`: passed on the final implementation.
- Focused FactoryServer, FactoryWebClient and FactoryPwa tests: **26 passed**.
  Behavioral tests additionally cover incomplete/digest-invalid builds and
  precache failure, root navigation/auth denial/502 fallback, unsupported
  workers, explicit install prompt/dismissal, bounded/expired/malformed
  snapshots, changed gates and conservative multi-tab cache cleanup.
- Biome on changed code/web assets: passed with 13 existing CSS warnings and
  no errors. `git diff --check`: passed.
- Install/help controls and native-prompt availability rendered in Chrome.
  The prompt's explicit invocation/dismissal is tested with a mock event;
  **no native installation or standalone launch is claimed**.
- Required macOS Chrome/Brave/Safari and iPhone Safari/Brave installation,
  launch/uninstall and protected HTTPS-origin evidence is **outstanding**.
  Native desktop automation was unavailable; no iPhone/iOS version was confirmed.
  Installed Brave 154.1.96.61 and Safari 26.6.2 are inventory only. Android's
  physical-device test is explicitly waived. Mobile emulation is not iPhone
  evidence. The implementation's overall native acceptance is not complete.
- No Web Push implementation; linked backlog follow-up is
  [Taskbot #69](https://taskbot.apps.janjaap.de/p/bobs-factory/t/69).

The installation paths in [Factory documentation](../../../docs/FACTORY.md)
were rechecked against official Chrome, Brave and Apple guidance on this date.
The fixture workers and owned browser sessions were stopped after the drive.

## Visual evidence

Final-build cold offline shell (Chromium emulation):

![Offline shell with reconnect instructions](media/2026-10-05-factory-pwa/pwa-offline-mobile.png)

Final-build recipe conflict; draft retained and Save disabled:

![Recipe conflict requiring explicit acknowledgement](media/2026-10-05-factory-pwa/pwa-recipe-conflict.png)

Earlier candidate: explicit update restored the open raw inspector:

![Restored artifact inspector](media/2026-10-05-factory-pwa/pwa-update-inspector-restored.png)

Earlier candidate: desktop installation help, without native installation:

![Desktop installation guidance](media/2026-10-05-factory-pwa/pwa-install-desktop.png)


## Workbox follow-up and user decision (2026-10-05)

The record above describes the initial implementation and its then-outstanding
native installation requirement. The user subsequently waived native-device
installation tests and requested maintained libraries. Native installation is
still unverified, but is no longer an implementation acceptance blocker.

The worker now bundles `workbox-precaching` and `workbox-routing` 7.4.1 locally.
Workbox downloads and stores the build-scoped precache and routes allowlisted
requests. Browser SRI validates resource bytes; the factory plugin validates
build/MIME/status and refuses redirects. There are no CDN imports or external
app providers. Explicit activation, conservative old-tab cache retention, the
root-only navigation fallback and draft/gate protections remain. The linked
[push follow-up #69](https://taskbot.apps.janjaap.de/p/bobs-factory/t/69) now records
maintained Web Push libraries and direct server-to-browser push-service delivery
with VAPID authentication, without a hosted notification provider. Push remains
outside this implementation.

A fresh isolated fixture at `node_modules/.cache/manual41-workbox` (UI 3635, RPC
3636) reused only the deterministic model fixture described above with a fresh
clone/home. It tested the previous custom worker `43cf49d72997c3a9359d04f6` to the
Workbox shell `332e05ff6a89d1078623add0`, without changing production state.

- F1 create-issue/start-session returned DEF-1/issue-1 and session-1. Four initial
  timestamped activities included routing, the thought and clarification.
- The native browser installed the complete Workbox precache with browser SRI:
  exactly eight static resources, no API/SSE/media or mutation entries. A waiting
  update coexisted with the old shell cache.
- Later preserved question/chat drafts and paused reading. Explicit update in
  one tab restored those drafts, route, open step and stable reading anchor;
  session storage was consumed. A second tab retained its own chat draft and
  old mounted UI without reloading. Both old/new static caches remained available.
- Before/after update, the same run retained its ID, workspace, waiting/clarify
  state, one history record and zero answers. No automatic action occurred.
- Connected data became stale and actions disabled after loss of connectivity.
  A controlled cold offline reload at 390 × 844 loaded the Workbox shell and
  retry guidance; reconnect refreshed the current run and enabled actions.
- Actual stale-build and changed-question POSTs returned 409; answers remained
  zero. One explicit current answer then continued the same run; releasing the
  fixture script completed it at checkpoint `end`, with three history records
  and exactly one answer. Pagination returned two of five tracker activities;
  F1 stop-session cleanly finished the tracker. Owned worker/browser were stopped.

Commands used the same F1/browser flow as the initial record with ports 3635/3636,
`agent-browser --session manual41workbox`, SIGUSR2 UI snapshot replacement and
`touch node_modules/.cache/manual41-workbox/release`. No new source changes were
made between this follow-up drive and the checks below.

Validation: `pnpm build` and `pnpm typecheck` passed. Focused FactoryServer,
FactoryWebClient and FactoryPwa tests: 26 passed. The PWA tests execute bundled
Workbox modules, including failed precache, bounded snapshots and multi-tab
cleanup. Node's mock fetch simulates SRI; the real browser drive checks native
successful installation. Binary asset inspection confirmed 192/512/512/180 PNGs
and a complete nine-route inventory including the 18,702-byte bundled worker.

`pnpm audit` exited 1 with two unchanged high advisories unrelated to the new
Workbox dependency graph: [node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv)
and [braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). Both advisories and
npm latest versions show no published patched version (`node-forge` 1.4.0,
`braces` 3.0.3); bumping their owners cannot currently produce zero advisories.
No advisory suppression, override or unrelated crypto/watch implementation was
introduced. At that point the repository zero-advisory mandate blocked
completion pending a scoped exception or separate remediation.

Workbox behavior follows its [precaching](https://developer.chrome.com/docs/workbox/modules/workbox-precaching)
and [routing](https://developer.chrome.com/docs/workbox/modules/workbox-routing)
documentation. Native Mac/iPhone/Android installation is not claimed.

![Workbox update restored the question draft](media/2026-10-05-factory-pwa-workbox/update-restored.png)

![Workbox cold offline shell at mobile dimensions](media/2026-10-05-factory-pwa-workbox/offline-mobile.png)

## Delegated security decision (2026-10-05)

The user responded to the two-warning exception question with **“You decide,
I don’t get it…”**. Under that delegated authority, the implementation proceeds
to review with a narrow exception to `CLAUDE.md`'s zero-advisory requirement for
this PWA change. This does not change the repository policy or resolve either
security warning. No unrelated dependency changes, audit suppression, publication
or deployment were performed.

A fresh `pnpm audit --json` exited 1 and reported the same two high-severity
warnings, with no patched versions listed. The dependency diff adds only
Workbox packages; `node-forge` 1.4.0 and `braces` 3.0.3 are unchanged. The
[node-forge warning](https://github.com/advisories/GHSA-86w9-cpqp-85rv) concerns
forged RSA signatures; the
[braces warning](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) concerns a
process crash from deeply nested patterns. Both published records were checked
again and list no patched version. Actual application exposure remains
unverified and needs separate security assessment and fixes.

The exception is limited to carrying this implementation into review because
the PWA adds neither warning nor a dependency path to the affected packages.
The existing build, typecheck, 26 focused-test results and F1/browser evidence
above remain valid; runtime code was unchanged during this decision pass.
`git diff --check` passed. Native installation remains unverified under the
user's recorded test waiver. Web Push remains in linked backlog ticket #69.

## Review restoration fixes (2026-10-05)

Tested PR head `6944c2002391e0f40c00bff2d64bf26b724dd8a9` plus the fixes
committed with this section. Final shell: `df1c47d7aa8d30e7b946e30c`.
F1 applies to the changed reading/activity and update-restoration behavior.
The fresh isolated fixture `node_modules/.cache/manual41-review-fixes` used UI
3645 and RPC 3646, a local bare origin, and its own clone/home/worktree. It reused
the real tracker, routing, runtime, checkpoints and server from the earlier drive.
Only the model was deterministic: emit 400 agent SDK events, each with text and
thinking blocks, ask one question, and continue after a deliberate answer.
The fixture also added 305 in-memory copies for read-only browsing.

- F1 create-issue/start-session returned DEF-1/issue-1 and session-1. The initial
  activity page showed four timestamped routing/thought/clarification activities.
- Navigated through all 305 copies in the same mounted browser app, allowing
  each run's default step to open, then returned to session-1. Empty drafts and
  untouched historical panels did not accumulate. The explicit-update snapshot
  contained only four records: current panels, question draft, chat draft and
  paused reading state. There was no size-limit error.
- Loaded an older activity page and paused around SDK message 162, outside the
  latest 120 events. The snapshot retained its event cursor through SDK block
  formatting. After reload, the browser requested the bounded activity page
  using that cursor; the older SDK messages and both drafts were restored, the
  restoration notice cleared, and the product snapshot was consumed.
- Tested explicit updates from the final shell to an isolated candidate differing
  only by an HTML comment (`eba7f7e04eb776403c0cad92`), then back to the final
  shell. The comment was removed before rebuilding the final source. Before and
  after both updates, session-1 retained its workspace, waiting/clarify checkpoint,
  one history record and zero answers. No automatic action occurred.
- Submitted the current question once through the browser. Releasing the fixture
  script completed the same run/workspace at checkpoint `end`, with three history
  records and exactly one answer. F1 pagination returned two of five activities;
  stop-session finished the tracker cleanly. No browser page errors were reported.
  The owned browser and worker were stopped.

Commands followed the earlier F1 flow with ports 3645/3646 and browser session
`manual41fix`. SIGUSR1 added the browsing copies; SIGUSR2 replaced only the server's
UI snapshot. Route checks ran in batches of 20 after a long browser evaluation hit
the automation timeout and was restarted with a fresh page. The passing evidence
above comes from the completed batch run and subsequent explicit updates.

Focused checks: FactoryPwa, ActivityPage, FactoryActivity, FactoryServer and
FactoryWebClient: **48 tests passed**. New regressions cover 301 pristine records,
cleared drafts, preserved explicit panel/blank-editor changes, refusal to discard
301 meaningful drafts, and refetching SDK anchors through text/thinking/tool blocks.
The edge-worker build, full `pnpm typecheck`, changed-file Biome and
`git diff --check` passed; repository build/typecheck gates also run at commit.
Native-installation waiver and the existing scoped audit exception are unchanged.
No dependency changes, Web Push, deployment or production-run changes were made.

Final-build restored older SDK reading and chat draft:

![SDK reading position and draft restored after update](media/2026-10-05-factory-pwa-review-fixes/sdk-reading-restored.png)


## CI merge-conflict resolution (2026-10-05)

Tested PR head `454986ed1ac7e63cd7dc1863cac6086bfd9dfb43` merged with
`origin/main` at `91656030c9b3e8d32bc2b2d3202864e895425e8a`, plus the
conflict-resolution edits committed with this section. Final shell:
`41b731ef662a96a5b9bb4abc`. F1 applies to the combined review navigation,
draft preservation and connection-gated actions.

Fresh validated fixture: `node_modules/.cache/manual41-ci-merge/home-validated`,
with a separate local repository/worktree, UI 3655 and RPC 3656. The compiled
EdgeWorker, real CLI tracker, issue routing, worktrees, workflow runtime, pending
human gates, API and SSE were used. A deterministic tool emitted the guide and
fixture PR receipt. No remote provider or production run was invoked. An initial
fixture omitted a required chapter field; its failed state is retained separately
in `home`. All passing assertions below use the corrected, fresh validated home.

- F1 create-issue/start-session returned DEF-1/session-1 and DEF-2/session-2.
  Timestamped initial and routing activities appeared in view-session.
- Selected the first Today card, entered the second review by a direct hash
  route in the same mounted app, and returned with Back to Today. The second
  card was selected and persisted, rather than the first card's older PWA state.
- Opened a feature chapter and its Code & evidence disclosure, and entered an
  unsent review-feedback draft. Later retained the mounted guide and draft.
- Explicit updates from the final shell to an isolated candidate differing only
  by an HTML comment (`c7b87c4419342b377fce361f`), then back to the final shell,
  retained `/#/runs/session-2/review`, chapter 1, its open disclosure and the
  revision-scoped draft. Update storage was consumed. For the second update,
  the Update button's click handler was invoked without automation scrolling
  the page to the button; the saved document reading position restored to 700px.
  The temporary source comment was removed before rebuilding the final shell.
- Before and after both updates, both runs retained their workspaces, pending
  gates, histories and zero decisions. UI snapshot replacement did not restart
  the EdgeWorker or runtime.
- The other review had no feedback draft. Returning to the original review
  retained its draft and Checks & decision page. The final review rendered at
  390 × 844; its unsent draft and disabled offline controls were captured.
- Offline status disabled Approve, Refresh guide and Send to Bob. The draft
  remained editable and visible. Reconnection restored valid actions. One
  deliberate Send to Bob recorded exactly one revision-bound rejection with
  the original feedback and workspace; no production PR was reviewed.
- F1 view-session pagination returned the two timestamped activities. Both
  tracker sessions stopped cleanly; owned browser and worker were stopped.
  No page errors occurred in the corrected validated drive.

Commands followed the existing F1/browser flow with ports 3655/3656 and browser
session `manual41ci`. SIGUSR2 replaced only the FactoryServer's UI snapshot.
Evidence receipts and the fixture are in the run evidence directory as
`ci-merge-before.json`, `ci-merge-after-update.json`,
`ci-merge-explicit-decision.json` and `ci-merge-fixture.mjs`.

The merged image route required its filesystem import and the private API
`no-store` expectation. The snapshot validator now accepts dedicated review
routes and boolean disclosures. A behavioral regression covers their round-trip
with revision-scoped feedback. Relevant existing factory, PWA, review, pipeline,
runtime, takeover and prompt-routing tests passed: **128 tests in 11 files**.
Full `pnpm build`, `pnpm typecheck`, changed-file Biome and `git diff --check`
passed. Repository build/typecheck gates also run at commit.

Native installation remains unverified under the accepted waiver. The scoped
exception for the two existing security advisories remains unchanged. This drive
does not establish provider merges, native installation, push delivery or any
production deployment. Historical evidence above is unchanged.

Final-shell restored review reading and disclosure:

![Review reading restored after update](media/2026-10-05-factory-pwa-ci-merge/review-reading-restored.png)

Final-shell revision-scoped feedback retained while offline:

![Review feedback retained offline on mobile](media/2026-10-05-factory-pwa-ci-merge/review-draft-offline-mobile.png)
