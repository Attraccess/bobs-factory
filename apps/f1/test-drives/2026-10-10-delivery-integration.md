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

## Native evidence supplement — exact candidate and current pending head

The historical unsigned native candidate `1.0.0-nightly.20261010.15` is source/tooling
`1fa3ba1ba19a8ea79ad3994a45af19f56a5fad32`, digest
`d053b7c2993931d93c88754fe7922e3c3c0352f2cb3bb18201584d2a7b2dea7f`, run
[38085071118](https://github.com/jappyjan/bobs-factory/actions/runs/38085071118).
All four binary and all four desktop jobs succeeded. Downloaded binary manifests
matched the actual archive bytes; desktop assets matched their build inventories,
and the runtime archives reused in desktop jobs matched the binary artifacts.
Target receipts, artifact IDs/container digests, native notice hashes, job links,
cleanup results and platform observations are preserved in
[FINAL_NATIVE_116](../../docs/distribution/FINAL_NATIVE_116.md) and its
[artifact index](../../docs/distribution/evidence/taskbot116-final-native/artifact-index.json).

This does not certify the current PR head. The exact reviewed desktop workflow
fix `ad6f0f8553f9c6df26591fc033764bf4bc354712` was integrated and pushed with the
report changelog follow-up at `b82c37c4fb9a3e18d1cb222c6d56d3fef852096f`.
Subsequent PR commits only update documentation/evidence and did not trigger
another native run.
The push-triggered native run [38086228778](https://github.com/jappyjan/bobs-factory/actions/runs/38086228778)
had a successful freeze, two Linux binary passes and two active macOS binary jobs
at the latest coordinator observation. CI [38086231619](https://github.com/jappyjan/bobs-factory/actions/runs/38086231619)
was active on Node 22/24. This new candidate's final identity and all-target
receipts remain pending and must not be relabeled with the `1fa3ba1b` evidence.
Linux Electron receipt stdout in the historical run contains DBus error lines
before its JSON payload; those raw bytes are retained and called out in the native
report rather than normalized.

Read-only Taskbot child snapshot: #117 `done`; #118 and #123 `in_review`; #119,
#120, #121, #122 and #124 `in_progress`; parent #116 remains `in_progress`.
No Taskbot status or acceptance field was changed. Native source/relink/licensing,
publisher trust/signing/rollout, signed Mac acceptance, real operator/platform
acceptance and GitGuardian disposition remain open as listed in
[the final native handoff](../../docs/distribution/FINAL_NATIVE_116.md).
