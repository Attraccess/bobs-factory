# Taskbot116 combined native candidate — pending

This is a nonpublishing CI fixture, not an approved release or completed epic.
The source/tooling freeze is `1fa3ba1ba19a8ea79ad3994a45af19f56a5fad32`.
Production code equals independently cleared `7be844f673ee4199fc01c52692f0ad78e786267b`;
the introduced delta is two unsigned CI workflows, a Linux cleanup receipt gate,
and the linked changelog. Coordinator review of that delta remains required.

Candidate version: `1.0.0-nightly.20261010.15` (committed package `1.0.0-beta`).
Candidate digest: `d053b7c2993931d93c88754fe7922e3c3c0352f2cb3bb18201584d2a7b2dea7f`.
Recipe: Bun1.4.2 / Node24.18.0; all four existing native targets.
The version label is local test allocation only. Its tag was absent from GitHub;
no tag, release, channel pointer, publisher key or signing receipt was created.

[Candidate bytes](evidence/taskbot116-final-native/candidate.json) and
[initial provider metadata](evidence/taskbot116-final-native/run-initial.json)
retain the exact identity. [Native run38085071118](https://github.com/jappyjan/bobs-factory/actions/runs/38085071118)
was in progress at observation. Artifact inventory was empty. No artifact hashes
or native PASS claims can yet be supplied; obtain original artifact bytes and
provider IDs/digests when the run finishes. Final reports must identify the later
report-only tip separately from this source/tooling freeze.

## Validation design and acceptance mapping

- #117: candidate-bound native archives, manifests and controlled signature interoperability.
  Schema2/source intake retains the earlier focused coverage; this run does not
  generate source completeness, licensing, genuine publisher trust or protected publication receipts.
- #118: all-target native bootstrap, installer ownership, tampered removal rejection,
  receipt-checked removal and update-policy handoff via smoke-public-install.
- #119/#120: preserved combined mock F1 lifecycle/drain/policy evidence plus actual
  native desktop Stop/maintenance and Linux waiting checkpoint/lease/rollback protection.
  No repeated broad unit or signed23 matrix.
- #121: four native desktop packages, actual Electron virtual-auth enrollment/login/logout,
  close/reopen attachment and Stop. Electron/Chromium notices and complete-app archives
  require fresh inspection of the retained artifact bytes after completion.
- #122/#124: disposable native-manager install/enable/disable/start/crash recovery,
  maintenance/resume/stop/restart/remove; no developer or production service changes.
- #123: same-byte runtime archives feed desktop packagers; AppImage/DEB/DMG and packed
  controlled npm trial validation. Catalog/npm identities and public submission remain operator work.
- Linux x64/arm64: actual test-signed whole-AppImage upgrade and failed-health rollback;
  same worker PID/nonce, waiting checkpoint bytes, lease deferral and bad-candidate suppression.
  A separate runner-only gate waits for fixture-path processes to exit, then atomically
  publishes the final receipt. Historical fixture stdout is retained as provisional,
  never accepted as a final PASS before this gate succeeds. Gate signals/removes no process.

Binary CI builds each target once; desktop jobs download those exact run/attempt/digest
artifacts and extract the archives. Runtime byte integrity is rechecked by desktopRuntime.
PR eligibility requires same repository, PR91 and the consolidation branch; frozen checkout
identities match the actual event head. Contents-read permissions, no inherited signing
secrets, no publishing and persist-credentials:false remain. Protected release workflow
files are unchanged. YAML parses, node syntax, Biome and required build/typecheck hooks passed.
The prior broad CI failure at7be was bun: not found; no broad rerun was requested here.

## Limits retained

All101 historical assets remain unchanged; signed23aa0ad, desktoped7 and whole-appb691
proofs retain their actual identities. Full-payload applicable mock F1 evidence at4a350aad
is preserved; these workflow/evidence additions do not introduce an F1 product workflow.
Modern macOS15/Ubuntu24.04 runners prove neither macOS13 nor glibc2.35 minima.
Unsigned Mac packing/open/service checks never authorize unsigned app activation;
genuine signed/notarized macOS activation/rollback remains an operator gate.
Physical credentials, second-machine control, live providers, minimum-platform,
reboot/logout/lingering, catalog/npm ownership and GitGuardian38083768/38084076 reviews
remain open. Official WebKitHTTP422 and all-four real objects/config/link-response/relink
material remain unassembled; structural schema2 fixtures are not legal correspondence proof.
No production homes/services/keys, signing/publication, remote merges, original PR closure
or ticket/status closure. Only coordinator owns Taskbot progress/acceptance mutations.
