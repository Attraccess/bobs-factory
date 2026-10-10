# Desktop/service owner integration — October 10, 2026

PR [#85](https://github.com/jappyjan/bobs-factory/pull/85) remains **draft**.
Taskbot #121/#122/#124 remain in_progress. This is implementation and bounded
native/mock evidence, not complete release or full-platform acceptance.

## Frozen sources and reusable outputs

- Runtime/adapter/F1 code tested at `edcdab9c8a00ee2df891bf73ab32165c6a7c682e`,
  combining desktop/service implementation with updater correction
  `ee7befdc`. The updater's complete correction evidence at `8be327b3` is
  retained in [its report](2026-10-10-update-safety-corrections.md).
- Branded packaging and final native cross-commit adapter drive frozen at
  `e490053495863763f5938196f086f5f22ff6e2b4`. Since edcdab9c only the desktop
  package icon and updater evidence documents changed. Subsequent launcher CSS
  formatting and explicit button types fix CI; they do not change runtime APIs.
- Combined checkout: `/tmp/bobs-factory-lifecycle-integration`, branch
  `test/desktop-updates-integration`; PR checkout `/tmp/bobs-factory-desktop-121`,
  branch `feat/desktop-service-121-122-124`. Both are isolated from the root.
- Reuse `/tmp/lifecycle-native-corrected-905/bobs-factory-1.0.0-nightly.20261010.905-darwin-arm64`
  as previous runtime (edcdab9c) and
  `/tmp/lifecycle-native-branded-907/bobs-factory-1.0.0-nightly.20261010.907-darwin-arm64`
  as target runtime (e4900534). Both include build.json and complete binary
  distribution resources; clean source, pinned Bun1.4.2, exact frozen candidate.
- Frozen candidate files: `/tmp/lifecycle-native-candidate-905.json` and
  `/tmp/lifecycle-native-candidate-907.json`. These use **isolated test sequences**,
  not authoritative nightly allocation or eligible published-channel evidence.
- Branded native app:
  `/tmp/lifecycle-native-desktop-branded/mac-arm64/Bob's Factory.app`.
  Unsigned DMG:
  `/tmp/lifecycle-native-desktop-branded/bobs-factory-desktop-1.0.0-nightly.20261010.907-mac-arm64.dmg`.
  SHA256 `2ae83c4c0a9c5175500004e42fb382eb7e36eaf8285f777899f0d7f694d8c0c8`,
  164144706 bytes. Bundle identifier `de.bobs-factory.desktop`, shared Factory
  icon.icns. [Inventory](assets/2026-10-10-desktop-service-integration/desktop-build.json)
  binds the runtime and DMG to candidate digest
  `42aadd5159645448026bbed28246614920adbcbcf3555e44ea51b2b03bc2104b`.
  No code signing/notarization/publication was performed.

## Observed checks

| Check | Result and limits |
| --- | --- |
| Full workspace build/types | Pass through required precommit gates; includes shared frontend types. |
| CLI | 178 tests pass, including marker-verified orphan termination/racing takeover, independent updater companion and interrupted stopped setup. |
| Updater/runtime | 63 tests pass across UpdateManager, UpdateOperationLock, UpdateMaintenance, PublishedUpdateSource and TicketTracking. |
| Desktop/package safeguards | Origin/partition contract and mismatched/tampered runtime staging checks pass. |
| Dependency security | pnpm audit reports zero known advisories. Electron44.7.0/electron-builder26.15.3 and scoped upstream transitive fix are locked. |
| Biome | CI initially failed on launcher CSS formatting and two button types. Corrected; complete local biome ci exits0 (19 pre-existing warnings). Remote Node22/24 CI and website build passed at ea1cd815 (runs38072947651/38072947642), before the later MCP correction. |
| Mocked desktop F1 | One home/worker, disconnected client leaves human wait, graceful stop/reopen preserves run/checkpoint, accepted answer completes once, protected activities retained. |
| Mocked updater F1 | Seven scenarios pass: busy/descendant deferral, manual-policy cancellation, preserved wait/gate/definitions/checkpoint, rollback and independent settings. Controlled worker counter peaks at1; not an OS service proof. |
| Mocked real-worker maintenance F1 | Actual EdgeWorker/OperatorServer reboot dispatcher and authenticated mutation admission paths pass; production admission/state machinery, controlled agents only. See updater correction report. |
| Actual native owner adapter | [Receipt](assets/2026-10-10-desktop-service-integration/native-update.json): unsigned real Bun executables, mocked release source. Successful cross-commit activation, immediate injected health failure rolls back, SIGKILL desktop-worker recovery, repeat exact release, supervisor exit immediately after link activation recovers without live worker API. Waiting question, workflow definitions/outputs/gates and mocked native checkpoint retained; each fixture's preparation hook runs once. Native credentials are represented by an isolated auth-boundary marker, not physical provider credentials. |
| Actual Electron44.7 on Mac ARM64 | [Receipt](assets/2026-10-10-desktop-service-integration/native-electron.json): virtual CTAP2 enrollment/login/logout, shared protected onboarding UI, close keeps worker PID, reopen same PID, explicit Stop. [Screenshot](assets/2026-10-10-desktop-service-integration/onboarding.png). Physical Touch ID/security keys, remote HTTPS and a running provider role were not tested. |
| Actual native packaging | Branded .app/DMG generated on macOS with bundled matching runtime and hash inventory; unsigned. This does not prove Applications drag/open, Gatekeeper trust or minimum OS support. |
| Four-target/native user managers | Prepared workflow + disposable-runner-only native-service smoke. Initial dispatch rejected with GitHub404 because desktop-build.yml is absent from default branch. An exact same-repository PR85 head preparation trigger is now implemented with one frozen source/tooling candidate, read-only permissions and no signing/publication secrets. Final push/freeze waits for the focused MCP admission correction. No four-target desktop run passed yet. |

Commands and receipts retained outside the checkout:

```sh
F1_AGENT_MODE=mock npm exec --yes --package=bun@1.4.2 -- bun apps/f1/test-drives/assets/desktop-service-lifecycle.mjs
F1_AGENT_MODE=mock npm exec --yes --package=bun@1.4.2 -- bun apps/f1/test-drives/assets/update-lifecycle.mjs
F1_AGENT_MODE=mock npm exec --yes --package=bun@1.4.2 -- bun apps/f1/test-drives/assets/update-maintenance.mjs
node apps/desktop/test/native-update-adapter.mjs /tmp/lifecycle-native-corrected-905/bobs-factory-1.0.0-nightly.20261010.905-darwin-arm64 /tmp/lifecycle-native-branded-907/bobs-factory-1.0.0-nightly.20261010.907-darwin-arm64
```

`/tmp/lifecycle-corrected-f1-{desktop,updates,maintenance}.json` retain console
receipts (the latter includes worker logs). `/tmp/lifecycle-native-e4900534-receipt.json`
and `/tmp/lifecycle-native-electron-edcdab9c-receipt.json` retain native receipts.
Use `env -u ELECTRON_RUN_AS_NODE` for the Electron native harness in T3.
All fixtures use temporary homes and mocked agent preparation; no real-agent
credits, host reboot, production PM2/service mutation, signing key creation or
publication occurred.

## Subsequent safety boundary and owner evidence

Independent updater review #116 comment1020 found that live MCP inspection could
spawn descendants during maintenance while drain reported idle. The updater lane
is correcting this. All native binaries and receipts above predate that correction
and remain provisional evidence; they cannot close final combined acceptance.

The owner adapter's native lost-release-ack regression also passes with actual
905→907 workers: acknowledgment is lost after healthy activation and actual
maintenance release; the journal retains exact pending succeeded outcome. A fresh
adapter acknowledges the same transaction, retaining the new installed version and
same worker PID with one activation. Receipt:
`/tmp/lifecycle-native-release-ack-provisional.json`. This too must be rerun on the
corrected combined source. The first fixture injected its failure during an
ordinary busy cancellation; injection now requires the selected new executable.
The explicit stopped-operation-owner recovery confirmation is supplied.

## Acceptance mapping

| Ticket / acceptance | Delivered seam and evidence | Remaining acceptance |
| --- | --- | --- |
| #121 branded native app / terminal-free runtime setup / onboarding | Electron shell uses existing web frontend, packaged runtime copied to explicit user-owned stable link; branded .app/DMG, protected first-launch UI and virtual auth tested. | Trusted signed drag-to-Applications/open, physical prerequisites and full repository/provider onboarding trial. |
| #121 local/remote selected instance / no duplicate worker | Canonical per-home worker fence; local attaches/start path, HTTPS-only remote origin input, origin partitions and bridge/navigation constraints. | Native remote HTTPS ceremony/isolation and #84 multi-instance UX; #84/#41 ownership not taken. |
| #121 close/reopen / explicit Stop | Real Mac Electron close retains PID, reopen same PID, separate verified Stop; detached worker+external supervisor independent of UI. | Linux native window/job trial; close during active controlled provider execution rather than idle fixture. |
| #121 auth / bridge / credentials / preserved work | Sandboxed windows, context isolation, no dashboard preload, launcher-frame-only bridge, navigation/permission restrictions; native runtime retained waits/outputs/mock checkpoints and auth marker. | Both OS physical passkeys, physical native provider continuation and end-to-end remote session isolation. |
| #121 native packages / targets / updater assets | DMG/AppImage/DEB matrix contract for macARM64/x64 and LinuxARM64/x64; native Mac ARM64 unsigned DMG actual. | Linux/x64 packages and clean install/removal; proposed macOS13/glibc2.35 minima unproven. Signed/public channel assets remain #117. |
| #121 configurable updates / continuation / mismatch | Shared persisted updater settings; external adapter stops only its owned worker, preflights isolated state, snapshots, atomically switches owned link, exact health, bounded rollback. Actual successful/failed native worker update and supervisor-crash recovery tested. | Signed source-to-installed integration with packaging lane; native client-version mismatch trial. Automatic replacement currently covers the user-owned worker/frontend, not the Electron shell bundle; shell upgrade/signing/updater asset integration remains open. |
| #122 display-free server / assets / independent jobs | Existing CLI `start` and user-manager `service run`; static web resources included for protected remote clients. Same worker/canonical home survives UI close. | Actual second-machine protected control and #84 connection UX. |
| #122 service ownership / reboot / prerequisites | Stored exact executable/home/platform/port/path, foreground/desktop/service fence, opt-in install and enrollment, independent updater unit. External/Nix/foreground takeover refused; stopped interrupted setup can resume matching missing definitions. | Native launchd/systemd/user-login/logout/reboot receipts; existing PM2/manual owner migration must deliberately stop old owner. No host service was changed. |
| #122 persisted policy / effective state / authenticated remote operations | Shared updater CLI/UI/API settings and health metadata; external timer owns activation and retries pending release independently of UI. Corrected F1 proves real-worker intake/mutation/reboot suppression. | Installed packaging adoption/default/override/pause/pin full integration; signed source download and real remote-host update trial. |
| #122 headless credentials / keychain limitations | Original account/HOME/PATH and native stores retained; docs explain Linux lingering, launchd login lifetime and pre-login/keychain limitations. | Native credential-store behavior under service/logout, physical runner continuation. |
| #124 ownership / install/status/logs/start/stop/restart/remove / enrollment | User-only definitions; stopped non-enrolled install, deliberate enable/disable; exact manager PID/active state/executable+home required for healthy. Companion status exposed; remove retains definitions/state. | Actual native manager availability/health/enrollment proof. |
| #124 crash/backoff / maintenance / explicit stop | launchd/systemd crash delay; marker-verified orphan descendants reconciled before new worker; desktop restarts bounded to3 per companion lifetime. Worker maintenance leaves companion alive; explicit Stop blocks during active update, otherwise suppresses restart. Staged failed runtime returns only after verified startup fence, preventing early rollback overlap. | Native OS-manager crash/maintenance/enable-disable/backoff receipts; crash during partial snapshot/rollback needs retained-state reconciliation rather than guessing. |
| #124 login/reboot/logout / waiting/native recovery | Exact user-service lifetime/lingering limitations documented. Actual native worker SIGKILL recovery plus waits/mock checkpoint preservation proven. | Real login/reboot/logout and physical provider continuation. No native app launch-at-login preference is supplied. |

The publication/signing/protected publisher-pin stages belong to separately
approved #117. This draft has no authentic published-channel candidate and does
not replace the updater or packaging lanes' remaining acceptance mappings.
