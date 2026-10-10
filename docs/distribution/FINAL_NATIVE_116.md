# Taskbot 116 native evidence and remaining gates

This is implementation validation for draft [PR #91](https://github.com/jappyjan/bobs-factory/pull/91), not release approval. Workflow correction `ad6f0f8553f9c6df26591fc033764bf4bc354712` and its changelog follow-up were pushed as `b82c37c4fb9a3e18d1cb222c6d56d3fef852096f`; subsequent commits only add this report and raw evidence. Those docs-only updates did not trigger native validation. The exact `ad6f0f85` change received a scoped workflow review CLEAR; that clearance covers the workflow blob, not the full current source tree.

## Current head: native validation pending

The corrected push trigger started [native run 38086228778](https://github.com/jappyjan/bobs-factory/actions/runs/38086228778) from `b82c37c4`; the later `83e18ec4` documentation/evidence commit was not a native trigger. The latest coordinator observation reports the freeze job succeeded, both Linux binary jobs passed and both macOS binary jobs were active. It is a new candidate and must retain its own frozen identity, artifacts and receipts. Do not reuse or relabel the earlier `1fa3ba1b` evidence for this head. [Initial run metadata](evidence/taskbot116-final-native/run-38086228778-initial.json.raw) is retained.

[CI run 38086231619](https://github.com/jappyjan/bobs-factory/actions/runs/38086231619) was active on Node 22 and Node 24 at that same observation. The prior CI run for `0f060728` ([38085618280](https://github.com/jappyjan/bobs-factory/actions/runs/38085618280)) completed successfully, but does not replace validation for the current integrated head. GitGuardian check `114313207629` reports four findings across 94 commits with no disposition; operator review remains open.

## Verified historical candidate run

The exact frozen source/tooling was `1fa3ba1ba19a8ea79ad3994a45af19f56a5fad32` (`1fa3ba1b`), version `1.0.0-nightly.20261010.15`, committed package version `1.0.0-beta`, candidate digest `d053b7c2993931d93c88754fe7922e3c3c0352f2cb3bb18201584d2a7b2dea7f`, Bun `1.4.2`, Node `24.18.0`, four targets. [Run 38085071118](https://github.com/jappyjan/bobs-factory/actions/runs/38085071118) completed successfully, attempt 1, with all four binary and all four desktop jobs successful. The run source and tooling were both `1fa3ba1b`; the current PR head is newer.

Every binary archive was downloaded from its matching artifact and its actual byte count and SHA-256 matched the target manifest. Desktop jobs reused those exact archives. Each delivered DMG, AppImage, DEB or complete-app update archive was downloaded outside the checkout; its actual size and SHA-256 matched `desktop-build.json`. The target runtime archive inside each desktop artifact also matched the binary archive byte for byte. No binary or installer package is committed.

| Target | Binary artifact / archive (bytes; SHA-256) | Desktop artifact / delivered assets (bytes; SHA-256) |
| --- | --- | --- |
| `darwin-arm64` | [artifact 11682705327](https://github.com/jappyjan/bobs-factory/actions/runs/38085071118/artifacts/11682705327), 65,829,871-byte artifact; runtime `32,587,788`, `54bc4f6f4fc758da2e63c289b8426613aa312f5c0632b2e94c629eb5a03947d5` | [artifact 11681761848](https://github.com/jappyjan/bobs-factory/actions/runs/38085071118/artifacts/11681761848), 369,530,465-byte artifact; DMG `166,726,620`, `3184aa7150831a76a3c9a9fb3e06ee41012e07507d5e15990d4db0fa8a909985`; update archive `170,975,817`, `c28f410e098490b84160d56f7621873620d78533d04d1c362a5be0c57adb907c` |
| `darwin-x64` | [artifact 11681681882](https://github.com/jappyjan/bobs-factory/actions/runs/38085071118/artifacts/11681681882), 70,190,988-byte artifact; runtime `35,002,336`, `f130c66f7f2ac4c39ee7bf8f1ce3fc02945f3e1591bce24ad44c405fbaca3867` | [artifact 11682461487](https://github.com/jappyjan/bobs-factory/actions/runs/38085071118/artifacts/11682461487), 382,514,850-byte artifact; DMG `172,850,583`, `84a34e5e4d53d48afcc8fe25e856fe1077070022fa97e40fa32efc7d6a82defb`; update archive `175,415,023`, `9d06f4a8841d8514d34e69e4aef49473d5eecdb2e6f3ddca50800d924f37ad9d` |
| `linux-x64` | [artifact 11682520582](https://github.com/jappyjan/bobs-factory/actions/runs/38085071118/artifacts/11682520582), 86,717,407-byte artifact; runtime `43,233,207`, `d00eda40ffda81550976ce8b7ed560cdcd2748d02f8dace6adcb366365470064` | [artifact 11682026688](https://github.com/jappyjan/bobs-factory/actions/runs/38085071118/artifacts/11682026688), 352,342,379-byte artifact; AppImage `173,057,129`, `d7a977f8cd8969a60970a70f2818a7c5bdeaaa0d54d1a100ef0675060a29b31f`; DEB `136,880,060`, `0c322a22d29f57d2dfacb9653061dbbd2031b1b10bfdf77a9ab2ed6164988a29` |
| `linux-arm64` | [artifact 11681876339](https://github.com/jappyjan/bobs-factory/actions/runs/38085071118/artifacts/11681876339), 87,208,554-byte artifact; runtime `43,213,483`, `4451d8a0c39ed0d51c1b99409f3dc9d6cbd7180909fb2aa6bfa8c34b4dc69dd1` | [artifact 11682820563](https://github.com/jappyjan/bobs-factory/actions/runs/38085071118/artifacts/11682820563), 346,583,638-byte artifact; AppImage `174,324,258`, `a26aa60e78b3d1832bc05a2293e7da53cd04868859beb0923a5c9e90395c1a54`; DEB `129,930,920`, `8adeb0cae2343d5437bec908a9083de35c67e75d6241deba6acc21abc1dbbd43` |

Artifact-container SHA-256 digests, artifact creation times, exact job IDs/URLs, executable and resource hashes, per-file raw receipt hashes, platform versions, license inventory and the full asset verification results are in the [artifact index](evidence/taskbot116-final-native/artifact-index.json). GitHub run/job/artifact API responses are retained as `.json.raw` alongside it. Binary and desktop receipt bytes are preserved by target under [the evidence directory](evidence/taskbot116-final-native/). Linux Electron receipt stdout contains DBus error lines before its JSON receipt; the raw file is retained unchanged instead of being rewritten as valid JSON.

## What these native jobs prove

- Each binary job passed native startup, dashboard/assets, protected API, scoped MCP, shutdown/restart, controlled public-installer behavior, native helper checks and prepared-agent protocol boundaries. Manifests, `build.json` and receipts bind each target's archive/executable to `1fa3ba1b`, the same candidate digest and a clean build. Prepared agent coverage used mocked/synthetic adapters, no authenticated provider inference; Gemini records one skipped test.
- Native helper receipts report macOS 15.7.9 (Apple M1 virtual and Intel runner) and Ubuntu 24.04.5/glibc 2.39 (x64 and arm64). Factory `LICENSE`, `NOTICE` and per-target `THIRD_PARTY_NOTICES.txt` size/hashes are indexed. Desktop metadata records Electron 44.7.0, `LICENSE` SHA-256 `5154e165bd6c2cc0cfbcd8916498c7abab0497923bafcd5cb07673fe8480087d` (1,096 bytes), and `LICENSES.chromium.html` SHA-256 `3375e2a9bd7bc631738fde10be6548a76efe8cf5e4b8826b8140ba8b0c4d6353` (20,115,518 bytes). These are recorded build-time notice checks, not the missing full source/relink license review.
- All four desktop jobs passed app packaging, service ownership and Electron lifecycle/virtual-auth checks. The receipt records close-window worker retention, same-PID reopen, explicit Stop and stop-vs-maintenance race rejection. It explicitly says native credentials were not tested. Both Mac outputs are unsigned; no signed/notarized macOS activation or rollback was run.
- Linux x64 and arm64 ran the actual complete-AppImage upgrade and failed-health rollback. Both cleanup receipts say `passed: true`, list no surviving fixture PIDs and bind the candidate version/digest/source. Assertions include active-lease deferral, external Electron helper entry/exit, candidate health identity, same worker PID/nonce, waiting checkpoint byte preservation, candidate stop before rollback and suppression of a failed candidate. Linux Electron output also carries the DBus errors described above; workflow/job and embedded receipt report passed, but the warnings remain visible evidence.

These are successful jobs and bound artifact checks for their exact historical candidate. The unsigned desktop metadata still states `native install/auth/lifecycle receipts required`; these jobs do not constitute signed release readiness.

## Taskbot 116 child snapshot

Read-only Taskbot snapshot taken 2026-10-10 during this handoff; Taskbot 116 remains `in_progress` and no ticket status was changed:

| Child | Status | Native evidence relation |
| --- | --- | --- |
| #117 stable/nightly publication | `done` | Publication mechanism only; genuine publisher pin, signing and rollout remain outstanding. |
| #118 verified installer/bootstrap | `in_review` | Historical candidate binary installer checks passed; current-head evidence remains pending. |
| #119 safe update/restart/recovery | `in_progress` | Mock lifecycle evidence plus historical Linux native rollback; current-head native run pending. |
| #120 nightly subscription/update policy | `in_progress` | Mock policy evidence; public release and authentic update execution remain gated. |
| #121 native desktop | `in_progress` | Historical unsigned four-target packaging and controlled lifecycle passed; signed Mac acceptance remains open. |
| #122 headless/service delivery | `in_progress` | Historical disposable service ownership checks passed; remote host acceptance remains open. |
| #123 installation entry points | `in_review` | Historical packaged installer assets passed; catalog/npm identities and publication remain open. |
| #124 startup/service lifecycle | `in_progress` | Disposable lifecycle receipts passed; login/reboot/logout/lingering acceptance remains open. |

## Outstanding release and operator gates

- A newly frozen, exact-source candidate and matching four-target native binary/desktop receipts for the current PR head. Do not treat the earlier `1fa3ba1b` run as proof for `b82c37c4` or a later native freeze.
- Full pinned WebKit source, all four genuine native object/source archives, build configs/toolchains, link responses and observed relink logs; the previous official WebKit HTTP 422 remains recorded. The complete source/relink/licensing intake and independent `licensingAndSource` receipt remain unassembled.
- Genuine publisher public-key pin, protected signing and explicit nightly rollout activation. No public tag/channel/installer/package has been created; public availability remains **none**.
- Protected Apple code signing/notarization and authentic signed Mac install/activation/rollback validation. Current Mac DMGs and update archives are unsigned.
- Physical passkey, second-machine access, real provider continuation, supported minimum macOS/glibc/CPU, login/reboot/logout/lingering, and clean-machine package-manager lifecycle acceptance.
- Operator disposition for GitGuardian findings in check `114313207629` (four findings/94 commits; no annotations/disposition available in the reported check).
- Root's review of the complete integrated tree and final changed documentation/evidence. Existing combined review `1208` was scoped to `7be844f6`; workflow correction review is scoped to `ad6f0f85`.

No real provider keys/credits, signing, publication, tags, production homes/services, remote merge, or ticket/child closure were used for this validation. Do not rerun the signed23 case matrix or full native matrix solely for this report; the corrected workflow's new push run is the relevant pending validation.
