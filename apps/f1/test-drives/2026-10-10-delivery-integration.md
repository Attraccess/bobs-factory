# Taskbot 116: combined delivery integration

Date: 2026-10-10. Tested code freeze: `4a350aadd6d0176814819f52c72ded055ef96482`.
Base: `4324a9fe2b48cb7cabb8e2979c5adebef82f332d` (`origin/main`, unchanged when fetched).
Isolated checkout: `/private/tmp/bobs-factory-taskbot-116-integration`.
Branch: `delivery/taskbot-116-integration`. This is implementation validation,
not public release acceptance. Documentation/evidence added after the tested code
freeze do not change executable, build, workflow or test source.

## Exact ancestry and child mapping

Merge final PR89 into current main, then PR84, PR87, PR88 and PR90. PR89 already
contains exact PR86 and PR85; they are not replayed or cherry-picked. All seven
frozen heads are ancestors, each integrated through its existing history once.

- [PR84](https://github.com/jappyjan/bobs-factory/pull/84):
  `fecdda18379ebc1cd91b20f63839bb7820fb24b1`; Taskbot118/123 installer,
  removal, trial and package-entry-point preparation.
- [PR86](https://github.com/jappyjan/bobs-factory/pull/86):
  `16e60465ed36e18ac45d71db38226dd4b0ccd4e2`; Taskbot119/120
  shared update policy, runtime replacement, drain and recovery.
- [PR85](https://github.com/jappyjan/bobs-factory/pull/85):
  `e05c0dfa965d41faeb958ef44ca4bbfb4a070f50`; Taskbot121/122/124
  desktop, headless service ownership and explicit startup controls.
- [PR87](https://github.com/jappyjan/bobs-factory/pull/87):
  `f39cd84f65e36f83dc97209ceaf1423df0469d8b`; Taskbot116 scoped
  signed-delivery evidence and fail-closed fixture receipts.
- [PR88](https://github.com/jappyjan/bobs-factory/pull/88):
  `c5b0eadad7068a608a283b0374ebd8c65ddccc0a`; Taskbot116 controlled
  native desktop acceptance and cleanup/receipt regressions.
- [PR89](https://github.com/jappyjan/bobs-factory/pull/89):
  `39a93e49dfee3e812a2e0f00a736c7a393e0da64`; Taskbot116/121
  complete-app updates, ownership-safe recovery and native notices.
- [PR90](https://github.com/jappyjan/bobs-factory/pull/90):
  `ac8ee1067576db6b260b03128af180117db37ca7`; Taskbot116 source/relink
  intake and bounded portable archive validation. Independent round3 clearance
  confirmed by coordinator comment1203. Its original pinned parent
  `0014fc4758a5f7e642a817761679d4e00d69a0c8` is reconciled with final PR89
  by ancestry merge; the original branch is unchanged.

Taskbot117 publication mechanisms are already in main; authentic signing,
activation and publication remain operator-owned. Original PRs and children remain
open; no status closure, remote merge, signing, catalog submission or publication.

## Lane-union comparison and semantic resolutions

The [pre-documentation tree audit](assets/2026-10-10-delivery-integration/lane-union-audit.json.raw)
compares each lane's changed blobs against the base and the combined code freeze:
253 changed union files, 253 combined changed files, zero missing files, all seven
heads ancestors. All101 historical asset blobs match an original lane exactly,
including failed runs, raw native evidence and their sanitization boundaries.
All production and build/workflow files match a reviewed lane's full blob.

Only three files have composed blobs at that freeze:

- `CHANGELOG.md`: preserve all lane entries when PR87/88/90 additions collide;
  make PR88's existing plain PR reference a valid linked reference. No entry is dropped.
- `docs/PRODUCT_CONTRACTS.md`: combine PR84's explicit public-trial/private-workspace
  distinction with PR89's per-instance and complete-app update contracts.
- `scripts/tests/public-install.test.mjs`: automatic merge retains PR84's
  receipt/removal/settings/recipe coverage plus PR90's new scanner dependencies
  copied into the isolated Pages fixture. No production semantic conflict.

In particular, `scripts/build-desktop.mjs` is byte-identical to final PR89,
including its pinned Electron distribution installation before license preparation.
PR90's source/archive modules and fixture changes remain byte-identical to ac8.
The automatic fixture merge passed the real installer/Pages tests below.

After the code freeze, only maintained docs, changelog and this report/evidence
are added. Reconcile stale docs that called implemented updates deferred, called
stable promotion latest-only, or called the whole-app updater unimplemented:
`apps/cli/RELEASING.md`, `docs/distribution/README.md`, `PUBLIC_RELEASES.md`,
`SERVICES.md` and the discovery row in `PRODUCT_CONTRACTS.md`. Their replacement
links describe existing reviewed mechanisms and preserve real acceptance gates.
Historical reports/receipts are untouched. Final tree comparison is recorded in
`docs/distribution/DELIVERY_INTEGRATION_116.md`.

## Combined checks

All commands ran in the isolated checkout with installed frozen dependencies.

- `pnpm install --frozen-lockfile`: passed, lockfile unchanged.
- Required pre-commit hooks on every merge: lint-staged, `pnpm build`,
  `pnpm typecheck` passed. Final documentation commit runs the same hooks.
- `pnpm lint`: passed; 19 CSS/accessibility warnings, no errors.
- `pnpm audit`: zero advisories.
- `node --test scripts/tests/{archive-path,bounded-archive,release-material,beta-attestation,nix-beta-attestation,native-receipts,release-candidate,release-discovery,release-extensions,release-publication,release-signature,public-install,trial-launcher,trial-launcher-bootstrap,desktop-runtime}.test.mjs`:
  91 passed, zero failures/skips. Actual release/source intake, protected
  publication guards, signature/channel identity, Pages fixture, install/removal,
  update handoff, trials and recipe verification use synthetic controlled artifacts.
- `pnpm --filter bobs-factory-edge-worker exec vitest run test/UpdateManager.test.ts test/UpdateMaintenance.test.ts test/UpdateOperationLock.test.ts test/PublishedUpdateSource.test.ts test/FactoryServer.update-startup.test.ts test/MachineCapacity.test.ts test/TicketTracking.test.ts test/EdgeWorker.factory-mcp-oauth.test.ts`:
  134 passed in8 files.
- `pnpm --filter bobs-factory exec vitest run src/services/DesktopLifecycle.test.ts src/services/InstallationOwnership.test.ts src/services/InstanceLock.test.ts src/services/ServiceLifecycle.test.ts src/local.test.ts`:
  21 passed in5 files.
- `pnpm --filter bobs-factory-desktop test:run`: 29 passed, zero skips;
  complete-app inventory/activation/rollback/policy races, actual outside-sentinel
  archive checks, launcher polling/consent and native acceptance receipt failures.
- `node scripts/tests/signed-delivery-harness-regressions.mjs RECEIPT`:
  14 successful harness assertions, including cleanup and initial/final-write failures;
  [exact generated receipt](assets/2026-10-10-delivery-integration/signed-harness-regressions.json.raw).
- Diff whitespace check outside byte-preserved historical assets: passed.
  Whole diff flags existing raw receipt/log whitespace; those bytes remain intact.

No unnecessary native matrix or historical23-case signed-delivery replay.
Test logs remain under `/tmp/taskbot116-integration-evidence/`; raw F1 receipts
and the lane audit are retained beside this report.

## F1 applicability, expectations and observed results

F1 is required for this payload's real runtime lifecycle, authenticated intake,
capacity/descendant drain, recovery, ownership and desktop interoperability.
Release/source/installer tooling uses dedicated checks above. Four relevant existing
scenarios ran with `F1_AGENT_MODE=mock` at the exact combined code freeze;
[commands, exit codes and identity](assets/2026-10-10-delivery-integration/f1-results.json.raw).
No paid providers, production homes/services or native credential stores were used.

1. `node apps/f1/test-drives/assets/update-lifecycle.mjs`: expected busy work and
   descendants to postpone activation, policy changes to cancel consent, and one
   owned replacement/rollback to preserve run/native checkpoint/gate state.
   Passed10 recorded observations, peak worker count1, continuation reused the
   mock native session ID. [Receipt](assets/2026-10-10-delivery-integration/update-lifecycle.json.raw).
2. `node apps/f1/test-drives/assets/update-maintenance.mjs`: expected real
   EdgeWorker maintenance to freeze new operator/dashboard/ticket intake while
   draining accepted operations through final writes and MCP descendant exit.
   Passed9 recorded observations, exact release resumed retained dispatch once.
   [Receipt](assets/2026-10-10-delivery-integration/update-maintenance.json.raw).
3. `bun apps/f1/test-drives/assets/desktop-service-lifecycle.mjs`: expected one-home
   ownership, client disconnect without lost waiting work, graceful reopen with
   the same run/checkpoint and exactly-once answer completion.
   Passed6 assertions through authenticated Factory detail/activity APIs.
   [Receipt](assets/2026-10-10-delivery-integration/desktop-service-lifecycle.json.raw).
4. `node apps/f1/test-drives/assets/desktop-shell-update.mjs`: expected active leases
   to defer UI replacement, complete-app upgrade/recovery/failed-health rollback
   to retain the worker PID/nonce and byte-exact waiting state, and shell settings
   to remain independent of backend settings.
   Passed5 assertions using protected API/drain, actual ownership/leases and
   scripted external UI processes. [Receipt](assets/2026-10-10-delivery-integration/desktop-shell-update.json.raw).

These controlled drives exercise real orchestration and protected APIs; their
scripted shell processes and mock checkpoints are not native Electron activation,
authenticated provider continuation, physical passkeys or native OS service startup.
Older four-target/native proofs stay bound to their original source and bytes.
This report is no automatic fullPayloadF1/licensingAndSource release PASS.

## Native evidence supplement — successful corrected-source candidate

The push-triggered [run 38086228778](https://github.com/jappyjan/bobs-factory/actions/runs/38086228778) passed freeze plus all four binary and all four desktop jobs. Its source/tooling is `b82c37c4fb9a3e18d1cb222c6d56d3fef852096f`, version `1.0.0-nightly.20261010.21`, digest `ca323a599f606523965d996ff871eeee784d7f5a419ce9158675077b3e4e43ec`, committed package `1.0.0-beta`, Bun 1.4.2/Node 24.18.0. This includes the reviewed `ad6f0f85` trigger fix integrated as `22e8b08d`; workflow blob `dd1e7d78d4a32a303147ac1c84cdb428dde23e00` is identical at the fix, integration, candidate source and documentation head `2673564a`. Later commits change only documentation/raw evidence.

All eight actual artifacts were downloaded outside Git. Binary archives and all desktop installer/update assets match manifests/build inventories; desktop jobs reuse byte-identical native runtime archives. Compact raw manifests/build inventories/freeze/service/Electron/shell-update receipts, hashes, verified runtime archive-member inventories and job/artifact provenance are assembled separately in the [source-b82 index](../../../docs/distribution/evidence/taskbot116-source-b82/artifact-index.json). Earlier source `1fa3ba1b` version `.15` evidence retains its own [unchanged index](../../../docs/distribution/evidence/taskbot116-final-native/artifact-index.json); all 53 prior-candidate files and 101 historical lane assets are byte-identical.

Both Linux actual unsigned AppImage/Electron shell-update/failed-health rollback receipts pass same-worker PID/nonce and waiting-checkpoint preservation, candidate stop before rollback, bad-candidate suppression and cleanup with no surviving fixture PIDs. Scope remains test-only RSA/simulated outer trust and Xvfb without sandbox, with no real provider or Apple signing. Four-target Electron CDP virtual-auth/service receipts pass; native credentials, physical passkeys and signed Mac activation remain unproven. Linux DBus pre-JSON diagnostics are retained byte-for-byte, and the carefully parsed trailing receipts both report `passed: true`; no production defect is inferred. Packaged Factory/Electron 44.7 notices do not complete licensing acceptance.

Node 22/24 both pass for source `b82c37c4` in [38086231619](https://github.com/jappyjan/bobs-factory/actions/runs/38086231619) and documentation head `2673564a` in [38086852959](https://github.com/jappyjan/bobs-factory/actions/runs/38086852959). Later documentation CI is not implied by these results. GitGuardian check `114315123906` fails with four generic findings across 97 commits and zero annotations; incidents `38083768`/`38084076` reference historical F1 maintenance evidence. No private disposition is available and findings are not assumed synthetic/classified.

The legacy `v1.0.0-beta` prerelease exists; new stable/nightly/native-desktop channels/catalogs are not activated. Full pinned WebKit (official HTTP 422), all-four native object/config/link-response/relink inputs and independent `licensingAndSource` remain UNASSEMBLED. Real trust/signing, Apple, catalog/npm ownership/public activation, physical-provider/minimum-platform/reboot and GitGuardian operator gates remain open in [FINAL_NATIVE_116](../../../docs/distribution/FINAL_NATIVE_116.md).

This supplement assembles completed evidence; it does not run a new F1/native/signed23 matrix or create a release acceptance PASS. The changed documentation/evidence needs direct JSON/link/hash checks and normal hooks. Per-child acceptance was reread; no ticket status is changed:

| Child | Status | Actual evidence | Remaining acceptance |
| --- | --- | --- | --- |
| [#117](https://taskbot.apps.janjaap.de/p/bobs-factory/t/117) stable/nightly publication | `done` | Frozen identity and all four native artifact pairs passed; publication mechanism independently reviewed. | Genuine publisher pin, protected signing, complete source/relink/licensing receipt and authorized six-hour nightly rollout/stable promotion; demonstrate public complete-target discovery and failed-publication recovery. |
| [#118](https://taskbot.apps.janjaap.de/p/bobs-factory/t/118) verified installer/bootstrap | `in_review` | Four native controlled-download installer receipts passed integrity, identity, repeat-install, removal/state and ownership guards. | Genuinely trusted published stable/nightly bootstrap on clean supported-minimum hosts; unavailable/offline/interrupted staging and saved-policy handoff across upgrades with host prerequisites/credentials intact. |
| [#119](https://taskbot.apps.janjaap.de/p/bobs-factory/t/119) safe update/restart/recovery | `in_progress` | Combined mock runtime/drain/recovery evidence and both actual Linux shell-upgrade/failed-health rollback receipts passed. Shell replacement kept the worker unchanged. | Authentically signed runtime replacement with real provider/native conversation continuation, interruption/reboot recovery and remote-instance isolation; preserve config, accepted results, drafts, waiting gates and native stores under supported ownership. |
| [#120](https://taskbot.apps.janjaap.de/p/bobs-factory/t/120) nightly subscription/update policy | `in_progress` | Controlled defaults, both overrides, pause/pin, queued-consent reconciliation and independent shell/backend policy evidence passed. | Published install → subscribe → later nightly automatic-idle update and stable manual/override flows; offline/coalescing, durable settings across entry points, pause/pin and safe compatibility-checked stable return on real installations. |
| [#121](https://taskbot.apps.janjaap.de/p/bobs-factory/t/121) native desktop | `in_progress` | Four unsigned packaged targets; Electron CDP virtual enrollment/login/logout, close/reopen same worker and explicit Stop passed. Linux AppImage update/rollback passed under test trust. | Signed/notarized macOS DMG drag/open and first-launch onboarding; genuine signed app activation/rollback; physical passkeys/native credentials, local/remote attachment and real provider continuation; explicit supported minimum OS/libc/CPU matrix and mismatch behavior. |
| [#122](https://taskbot.apps.janjaap.de/p/bobs-factory/t/122) headless/service delivery | `in_progress` | Native disposable user-service ownership receipts and controlled protected remote/API lifecycle evidence passed; backend does not depend on a desktop window. | Second physical headless host controlled from another machine, same-user service restart/reboot and real credential/provider access; connection loss, busy/idle runtime updates and native continuation under actual launchd/systemd constraints. |
| [#123](https://taskbot.apps.janjaap.de/p/bobs-factory/t/123) installation entry points | `in_review` | DMG, AppImage, DEB and Mac complete-app archive hashes verified; controlled trial/recipe and ownership checks passed. | Choose/verify Homebrew tap or catalog, AUR maintainers and Bob-owned minimal npm launcher identity; publish only genuine signed eligible assets, then clean-machine install/trial/open/upgrade/remove and ownership-conflict acceptance for each advertised entry point. Upstream monorepo npm remains retired. |
| [#124](https://taskbot.apps.janjaap.de/p/bobs-factory/t/124) startup/service lifecycle | `in_progress` | Disposable install/status/start/stop/restart/remove, close/reopen and Stop-versus-maintenance receipts passed. | Isolated login/reboot/logout/lingering, enable/disable, crash/backoff and interrupted-setup acceptance; deliberate PM2/manual/Nix adoption/migration without duplicate workers; workflow/native-session/waiting-gate recovery. macOS GUI LaunchAgent does not prove pre-login keychain access. |
