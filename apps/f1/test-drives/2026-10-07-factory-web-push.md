# Opt-in Factory Web Push

Date: 2026-10-07. Tested `04f29693c76edb83e59fae320d38eaaf71cb648a` plus the uncommitted Taskbot #69 implementation. Final served web build: `45fb29dbac8b8271b759c744`. No PR, publication or merge occurred.

## Applicability and isolated fixture

F1 applies to Factory attention transitions, session lifecycle and notification UI. The fixture used the compiled EdgeWorker, real CLI issue tracker, isolated worktrees, real WorkflowRuntime questions/review gates, protected dashboard APIs and SSE. Agent answers and the human-review provider snapshot were deterministic fixtures. The sender recorded receipts rather than contacting a real subscribed device. No production ticket, PR or approval was changed.

Repository: `/tmp/factory-push-drive-74357df8`. Worker home: `/tmp/factory-push-fixture-74357df8`. UI: 3597; F1 RPC: 3600; fixture-only controls: 3598. The controls are outside the shipped product. Title generation was disabled; no harness agents were launched. Node 24.21.0 ran the worker; Bun 1.4.2 ran the CLI and a separate real-transport smoke check.

Evidence directory: `/Users/jappy/.cyrus/factory/evidence/manual-56a8faa8-c83d-4083-a81b-b98174357df8`. Reproduction scripts, worker log, provider-shaped receipts, restart records, audit JSON and compact build provenance are retained there.

Commands used:

```sh
pnpm install --frozen-lockfile
pnpm --dir apps/f1 build
apps/f1/f1 init-test-repo --path /tmp/factory-push-drive-74357df8
node <evidence-directory>/f1-push-fixture.mjs
CYRUS_PORT=3600 apps/f1/f1 ping
CYRUS_PORT=3600 apps/f1/f1 create-issue --title 'Opt-in push fixture' --description 'Deterministic question, review and completion validation.' --labels 'workflow:push-drive'
CYRUS_PORT=3600 apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3600 apps/f1/f1 view-session --session-id session-1 --limit 6
node <evidence-directory>/push-drive-checks.mjs
node <evidence-directory>/push-drive-checks.mjs --continue
node <evidence-directory>/push-drive-finish.mjs
agent-browser --headed false --session factory-push-74357df8 open http://127.0.0.1:3597
```

The first driver used incorrect answer/review route names; they were corrected to `/answer` and `/review`. Its fixed one-second wait was too short for a real worktree launch followed by notification coalescing; the continuation polled the resulting receipt. These were fixture errors, not product failures. All intended assertions were subsequently observed; the complete script and continuation receipts are retained.

## Runtime results

- DEF-1/session-1 selected `push-drive`, created an isolated worktree and waited on an actual runtime question. F1 activities included initial response, routing and clarification.
- Two devices registered after the question was already pending. Registration sent no old question. Changing the question produced exactly one receipt per device. An ordinary runtime progress save produced no new receipt.
- Answering entered the actual SHA-bound human-review gate, producing one review receipt per device. Replacing its gate ID produced one new receipt per device.
- Disabling the second device stopped targeting it. An explicit fixture gate approval completed the workflow; only the first device received completion. No real provider approval or merge was submitted.
- A separate manual workflow failed a real shell command. The first device received failure; an explicit retry after creating the recovery marker completed and produced completion without a review guide.
- The protected test route used the production orchestration path and injected sender. The response distinguished sender acceptance from observed device receipt. Ten total fixture receipts were retained. Device-list responses exposed no endpoint or subscription keys.
- Graceful worker restart retained VAPID keys, disabled-device state and ten receipts. No old attention or completion was replayed across subsequent asset-validation restarts.
- Unit checks cover transient failure/backoff consumption, events created during backoff, coalescing, claims persisted before sending, disable/re-enable generation changes, expired endpoints, corrupted storage isolation, explicit permission/denial/revocation, registration rollback and cross-tab disable winning over an earlier enable.
- Bun 1.4.2 exercised the real encryption/VAPID/HTTPS sender against an intentionally invalid Google FCM endpoint. The test was not accepted and the expired device was removed. This proves an actual provider request and failure handling, not a valid subscription or background delivery.

## Browser and worker results

Headless Chromium 154 used only the fresh named session, at desktop and 390 × 844 mobile sizes. Both layouts had no horizontal page overflow. The notification dialog's content scrolls vertically; labels, support, browser permission and separate device states are readable.

The actual browser permission request returned `denied` in headless Chromium. Enable remained unsuccessful with an explicit explanation, while Today remained usable. Remote device metadata showed one enabled device and one disabled device independently. No permission request occurred on initial app load or reconciliation in focused browser-controller tests.

An injected service-worker message exercised the real application click protocol: navigation opened the completed run's review route, refreshed authoritative state and exposed no stale approval. Returning to Today retained the unsent composer draft. Explicit app updates after worker restarts also retained that draft and paused writes until current data refreshed. No browser app errors were collected.

Bundled-worker tests exercise visible minimal notification display, malformed-payload fallback, same-origin tab focus/message without reload, safe new-window destinations and rejection of external links. Existing Workbox static-only caches, waiting-worker update behavior and draft restoration checks passed. This synthetic worker coverage does not establish OS notification clicks.

Final screenshots, saved and visually inspected:

- `notifications-final-desktop.png`
- `notifications-final-mobile.png`

## Verification and accepted security exception

- Relevant Factory suites: 133 tests passed across six files. Later focused checks passed all 12 push/controller tests after the final reconciliation change and all seven push-service tests after the final timestamp adjustment.
- Native stop, pending-work and chat-continuation suites: 26 tests passed across three files.
- Root `pnpm typecheck` and `pnpm build`: passed. Final edge-worker typecheck/build: passed.
- Changed-file Biome and `git diff --check`: passed.
- Resume checks on 2026-10-07: the tracked diff fingerprint matched the saved validation provenance. Push, notifications, server, web-client, PWA, pipeline, native stop, pending-work and chat-continuation suites passed 128 tests across nine files. Edge-worker typecheck, changed-file Biome (21 files) and `git diff --check` passed. No code changed during this visit; prior root build, F1 and browser evidence were retained without rerunning those workflows.
- Final frozen-lockfile install: passed. Lockfile refreshes resolve patched `proxy-addr` 2.0.8 and `source-map-js` 1.2.2 naturally; no new override was added.
- `pnpm audit`: fails with two existing high-severity warnings, `node-forge` 1.4.0 and `braces` 3.0.3. Neither has a published patched version. The new push graph adds no warning. On 2026-10-07, the human answered “Accept” to the question requesting a Taskbot #69 exception limited to [node-forge GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) and [braces GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). This resolves the implementation blocker; it does not fix the vulnerabilities or waive other security warnings. The resumed audit reports exactly these same two warnings; its output is retained as `audit-resume.json` in the evidence directory.

Physical-device and background delivery on macOS Chrome/Brave/Safari, iPhone Safari/Brave Home Screen apps and Android Chrome were not verified. Headless mobile emulation and injected provider acceptance are not device-delivery evidence. Protected HTTPS/tailnet registration/test/disable/click flows were not verified: `tailscale serve status --json` returned `{}` on this machine. Exact trusted-origin guards were verified through protected API tests; no deployment guards were globally relaxed. A stable HTTPS origin and VAPID contact must be configured by the operator.

Tracker synchronization remains runtime-owned. The supplied ticket snapshot still describes #69 as backlog and #41 as in progress despite the later implementation authorization; supplied lifecycle receipts were delivered. No tracker state or duplicate lifecycle comment was posted by this role.

## Cleanup

The named headless browser and isolated worker were closed after validation. No human decision was submitted to a production run. Temporary repositories and evidence remain for reproduction. Historical F1 reports are unchanged. Implementation is preserved on the existing factory branch for subsequent review and delivery roles; no PR was created or published by this role.
