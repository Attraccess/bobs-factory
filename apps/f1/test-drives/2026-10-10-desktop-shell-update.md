# Complete desktop shell update preservation

Date: October 10, 2026. Implementation: [PR #89](https://github.com/jappyjan/bobs-factory/pull/89), stacked on PR #85 final evidence tip `e05c0dfa965d41faeb958ef44ca4bbfb4a070f50`.

Current frozen source/tooling: `b6917edb845ac482f3910cc98525d75e5cd67c05`. Product/build source is unchanged from `03abb4a7a8b6787e7fe8c3fa0b5c7e25fb5b0257`; the final delta corrects only the native readiness fixture. Product review fixes are at `133c2fcd4c16695d180eb69a5ee32ca509d6848d`; the following build fix materializes pinned Electron before copying notices, and the final fixture correction respects maintenance-only drain inspection. Initial freeze `fef29b8855994dbd1880bc40a4c351537884eedc` remains separate failed native evidence. This changes the entire Electron app, independently of the runtime executable. Original ed7/native and signed-runtime receipts remain historical evidence for their original hashes; they do not prove this new shell source.

F1 applies because shell activation changes the shared worker maintenance/drain path and must preserve running/waiting workflows. The isolated drive uses actual FactoryServer protected terminal sessions, WorkflowRuntime, UpdateDrain, MachineCapacity and genuine worker ownership records. Agent/provider execution is refused; UI executables are controlled Node scripts. This is mocked/scripted F1, not native Electron or model/native-provider evidence.

Command at the frozen product source:

```sh
bun build apps/desktop/src/update-services.ts --target node --format esm --outfile apps/desktop/src/update-services.mjs
F1_AGENT_MODE=mock node apps/f1/test-drives/assets/desktop-shell-update.mjs
```

Local tools: Node 26.0.0, Bun 1.3.5, pnpm 10.33.1. [Raw five-check PASS receipt at current freeze](assets/2026-10-10-desktop-shell-update/b6917edb-f1.json.raw).

| Behavior | Observed assertion |
| --- | --- |
| Active work admission | An actual capacity lease cancels activation before any UI/worker signal; candidate remains pending. |
| Verified automatic app switch | Controlled RSA-signed candidate replaces complete scripted UI bytes after old UI exit. Worker PID/nonce stays identical. |
| Waiting state and native stores | Saved workflow/checkpoint/definitions/outputs/config bytes and credential sentinel remain identical; no copy or rewind of mutable state. Mock native checkpoint, not real provider continuation. |
| Interrupted switch | After a modeled interrupted replacement and stale operation owner, recovery restores authenticated prior app and verifies prior UI health without restarting the worker. This is a modeled interruption, not a power-loss trial. |
| Failed shell | Failed UI exits before prior UI is restored; worker and checkpoint bytes remain untouched; exact bad candidate is suppressed on repeat tick. |
| Independent settings | Local shell settings use `<factoryHome>/desktop/updates`; backend settings stay separate. Remote hosts are never addressed by the shell helper. |

Focused checks: 42 app/license/UI/inventory/discovery/publication tests (17 dedicated app/license/UI tests), 56 existing shared UpdateManager tests, required build/typecheck and Biome hooks passed. The app regressions cover traversal/link ancestry, signed artifact tamper, immutable receipt binding, stale ownership, default/manual policy and final authorization races for pause/pin/channel/manual changes. New review regressions drive actual outside-sentinel filesystem paths, repeated production recovery with foreign bytes/symlinks/dangling links, and an open VM/DOM launcher with background discovery, dirty-form preservation and exact captured consent. The corrected resolver also round-tripped the actual Electron44.7 framework tree. These tests use generated test-only signing keys, never production trust. Publication tests initially collided with another concurrent fixture's shared OS temporary publication lock; the unchanged tests passed in a private TMPDIR namespace. [Raw 42-test output](assets/2026-10-10-desktop-shell-update/133c2fcd-focused.log).

## Native new-source preparation

Current [run38082354282](https://github.com/jappyjan/bobs-factory/actions/runs/38082354282) freezes source/toolingb691 above with Node24.18.0, Bun1.4.2 and Electron44.7.0. Terminal PASS on all four targets. Exact version `1.0.0-nightly.20261010.15`, candidate digest `74b03ef56e09b33dc2037d2d9449c9fd08fde26cfcffbd6751437487f8d286e1`. [Authentic workflow result and receipt index](assets/2026-10-10-desktop-shell-update/b6917edb-native/receipt-index.json) bind the GitHub artifact IDs, ZIP sizes, raw receipt hashes and complete installer/update payload hashes. Receipts were fetched using authenticated HTTP ZIP ranges, preserved without rewriting as original artifact filenames plus `.raw`; the index is derived. Raw Electron smoke output on Linux includes harmless D-Bus diagnostics before its PASS JSON. All four native service and Electron virtual-auth/menu/Stop lifecycle checks passed. Both Linux targets additionally passed actual whole-AppImage upgrade and failed-health rollback with the same native worker PID/nonce and byte-exact waiting workflow checkpoint. Mac unsigned installers/recovery archives passed packaging and notice checks; no Mac shell activation bypass was used.

Historical runs remain separate:

- [fef run38079712746](https://github.com/jappyjan/bobs-factory/actions/runs/38079712746) failed: actual internal Mac framework symlink chains were not supported, and both Linux fixtures compared an invalid unconfigured pre-startup waiting state after actual helper activation. [Original Linux failure stdout](assets/2026-10-10-desktop-shell-update/fef29b88-linux-x64-failed.log) is retained. No rollback PASS is inferred.
- [58 run38080258287](https://github.com/jappyjan/bobs-factory/actions/runs/38080258287), candidate digest042dae8da6e9541eefddd7afc6163f19059ef0ba7f4767bf2656c0b16c5b680b/version1.0.0-nightly.20261010.11, passed MacARM/x64 preparation/native smoke, but both Linux complete-shell fixtures failed before activation: the new checkpoint fixture omitted mandatory stock workflows. [Actual ARM failure stdout](assets/2026-10-10-desktop-shell-update/58cb5e40-linux-arm64-failed.log) is retained. Frozen58 independent review additionally found foreign-app recovery overwrite, filesystem-order symlink escape, and stale open settings. Those product findings are fixed at133c above; this does not relabel58.
- [0014 run38081088653](https://github.com/jappyjan/bobs-factory/actions/runs/38081088653) was cancelled at startup when the independent findings arrived, to combine them with notice preparation; it proves no native/licensing acceptance.
- [133c run38081493640](https://github.com/jappyjan/bobs-factory/actions/runs/38081493640) passed app regressions but failed all4 preparation before packaging because fresh pnpm checkouts had not extracted Electron's distribution. [Raw Linux preparation failure](assets/2026-10-10-desktop-shell-update/133c2fcd-linux-x64-preparation-failed.log) is retained. Build-only03abb explicitly invokes the pinned native Electron installer with upstream package checksums before notice preparation.

- [03abb run38081694851](https://github.com/jappyjan/bobs-factory/actions/runs/38081694851), digest `a1e00110dc11a52c7fadad9364cc6ea98b3026acb83e3d048e80994a4608f492`, version `1.0.0-nightly.20261010.14`, passed both macOS jobs and all four actual installer/update attribution checks. Both Linux jobs passed service/menu/auth lifecycle smoke but failed before app activation: the fixture attempted protected update drain inspection without its maintenance fence (production correctly returned409). [Four authentic target inventories/receipts](assets/2026-10-10-desktop-shell-update/03abb4a7-native) remain tied to03abb. Final fixtureb691 uses the protected run API and captures the byte baseline after actual fenced maintenance admission; it does not weaken the drain guard.

The Linux-only complete-shell fixture builds distinct test previous/failed AppImages from the frozen source, stages the actual candidate image using controlled RSA public trust and simulated outer release inventories, drives the real external Electron Node-mode helper, and checks actual Electron exit/replacement/health/rollback with a native Factory worker and saved waiting checkpoint. Its injected candidate health failure occurs after the real candidate readiness proof, then rollback must verify real prior UI readiness. Test variants are not public release artifacts. macOS unsigned app recovery archives remain refused by the production OS-signing gate.

## Exact final native payloads

| Target | Actual file | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| darwin-arm64 | `bobs-factory-desktop-1.0.0-nightly.20261010.15-mac-arm64.dmg` | 166701803 | `651c038f1c558c0ad7b5166c2a117dff84b16dab021cf985ce4bdbbf8059cf73` |
| darwin-arm64 | `bobs-factory-desktop-1.0.0-nightly.20261010.15-mac-arm64.bobsapp.gz` | 170969481 | `51a22c08a8d2e4edfb66d30005f4a8fd983fe2b1999e4d2d4ab4a250e1c3bfe5` |
| darwin-x64 | `bobs-factory-desktop-1.0.0-nightly.20261010.15-mac-x64.dmg` | 172834085 | `5ec93fddefbf8d220ee75b3d9035a0776b4af9d5493e93dd90f09b66274aeaf8` |
| darwin-x64 | `bobs-factory-desktop-1.0.0-nightly.20261010.15-mac-x64.bobsapp.gz` | 175402895 | `a3503a355f33f6127038b84064ebf57a4d564c3a81e5a2393aa51f347f841ec6` |
| linux-arm64 | `bobs-factory-desktop-1.0.0-nightly.20261010.15-linux-arm64.AppImage` | 174320123 | `75deef4e223e1b5e3777c7d475da070f71d3e30fb420f45dc2b79ac0bce2f57f` |
| linux-arm64 | `bobs-factory-desktop-1.0.0-nightly.20261010.15-linux-arm64.deb` | 129923444 | `1429f318ce8850c79966c5a2ea32426b5a87839bccd3285ece1607f6ca90d2cc` |
| linux-x64 | `bobs-factory-desktop-1.0.0-nightly.20261010.15-linux-x64.AppImage` | 173048985 | `264071449b9a82e2100a96a6d8bccfe539771b5527d442b7af435bc361dfbcbb` |
| linux-x64 | `bobs-factory-desktop-1.0.0-nightly.20261010.15-linux-x64.deb` | 136873676 | `3c7186d863d674e8c2f45ac6fe609d7efb80471589de72b20ec8155c06f09237` |

## Attribution payload

The exact native Electron44.7.0 distribution supplies LICENSE and LICENSES.chromium.html, copied to packaged resources/electron-licenses. Their version/size/hash records are required by desktop metadata and authenticated app proof; Mac staging checks actual extracted files. Preparation inspects actual mounted read-only DMG, extracted AppImage/DEB and exact Mac full-app archive roundtrip, then records comparisons and artifact hashes in candidate-bound desktop-build.json. The actual03abb four-target notice checks passed; the final b691 four-target receipts also passed. Each installer and update payload retained exact vendor LICENSE (1096 bytes, SHA-256 `5154e165bd6c2cc0cfbcd8916498c7abab0497923bafcd5cb07673fe8480087d`) and LICENSES.chromium.html (20115518 bytes, SHA-256 `3375e2a9bd7bc631738fde10be6548a76efe8cf5e4b8826b8140ba8b0c4d6353`). Downloaded metadata hashes/sizes match the actual native inventories and bind those records to the exact candidate. This is notice inclusion evidence only; reviewed runtime/Electron source/object/relink material and a licensing acceptance receipt remain separate. PR90 source work is not integrated or cleared here; incomplete material is not described as a completed archive.

PUBLIC_RELEASES assembly instructions are aligned to the coordinated PR90 schema2 contract; its source scripts/materials remain a separate owner and integration/review lane. No PR90 source files were edited here. This report and final documentation/receipt commit do not change the frozen production/build/native fixture source above.

Remaining gates: authentic public trust pins/catalogs; real Apple signing/notarization and signed Mac shell activation; physical credentials; minimum macOS/libc and login/reboot proofs; package-manager/account/publication approval; GitGuardian synthetic incidents `38083768` and `38084076` (four occurrences) require scoped operator review. No production home/service changes, real provider credits, signing/key access, tag/publication/merge, or ticket completion.
