# Taskbot 116 integration handoff

[Draft PR91](https://github.com/jappyjan/bobs-factory/pull/91) integrates PR84–90
on current main without closing or merging
the original lanes. See the [combined verification record](../../apps/f1/test-drives/2026-10-10-delivery-integration.md)
for exact heads, child mapping, conflict handling, commands and scoped receipts.

Tested production/test/build freeze: `4a350aadd6d0176814819f52c72ded055ef96482`.
Base: `4324a9fe2b48cb7cabb8e2979c5adebef82f332d`. Subsequent changes are docs,
changelog and integration evidence only. The final reviewed combined tip is the
proposed source/tooling input for a future new immutable native candidate; no
candidate version/digest or public release approval is allocated by this handoff.

## Complete changed-file comparison

The seven exact heads and all253 union files are included. All101 historical asset
blobs remain unchanged. At the tested freeze250 files exactly match an original
lane; three are composed: changelog entries, the contract inventory, and installer
fixture coverage/scanner dependencies. No production/build/workflow blob has a
semantic resolution beyond a reviewed lane. Final documentation reconciliation
adds these reviewed-tree differences:

- `CHANGELOG.md`: integrated handoff entry and valid PR88/consolidation links.
- `docs/PRODUCT_CONTRACTS.md`: retain all new contracts and describe the implemented
  runtime/desktop discovery consumers instead of a future updater.
- `scripts/tests/public-install.test.mjs`: exact automatic composition of PR84's
  tests with PR90's scanner dependencies; passed real installer/Pages suite.
- `apps/cli/RELEASING.md`: explicitly selected nightly promotion and links to
  implemented owned-update mechanisms.
- `docs/distribution/README.md`, `PUBLIC_RELEASES.md`, `SERVICES.md`: remove stale
  deferred/unimplemented claims, link the implemented mechanisms and keep rollout
  and signed native activation gates explicit.
- This handoff, the combined F1 report and seven new raw integration artifacts.

PR90 source/archive modules, source-material docs/provenance and original input
hashes exactly match ac8. Final PR89's desktop production/build/workflow code,
including the Electron notice preparation fix, is unchanged. Its pinned older
parent in PR90 adds no obsolete overwrite or lost correction.

## Review and native freeze

All lane-specific independent correction reviews are cleared, including PR90
round3 at exact ac8 (Taskbot116 coordinator1203). Root coordinator owns a fresh
combined integration review. No missing implementation correction is identified
by this merge, audit or focused validation; this is not overall acceptance.

This combined source has new installer ownership/handoff and stricter schema2
source/legacy/archive intake. It is not the source of the old native builds.
Retain their actual bindings: signed23 on historical aa0ad/ca3784, desktop native
ed7, and final whole-app native b691/run38082354282. None can be relabeled with the
new combined SHA or used as newly byte-bound receipt evidence.

After the combined review and required source inputs are ready, freeze one new
candidate with the reviewed combined source/tooling, allocated version and recipe.
Obtain fresh matching native binary/installer/service/desktop artifacts and
receipts for all four targets, including Linux complete-app activation/health
rollback and real Electron/Chromium notices. Signed Mac activation requires its
protected signed/notarized app and genuine native activation/rollback validation;
unsigned preparation cannot satisfy it. Reuse source-only assessments only with
an explicit reviewed applicability explanation. Do not rerun the historical
signed23 fixture as if it were proof of a different release candidate.

## Reviewable operator input and acceptance checklist

These are separate inputs or actual platform acceptance observations, not invented
implementation failures or assumed PASS receipts:

- [ ] Root's independent combined review of exact final tip and differences above.
- [ ] Complete patched WebKit source at the maintained pin; prior official HTTP422
  fetches remain recorded, not replaced by a sparse/incomplete archive.
- [ ] Genuine native objects/static libraries, exact build configs and toolchains,
  link response and observed relink logs for darwin-arm64/darwin-x64/linux-x64/
  linux-arm64, matched to final executable/runtime hashes. All four remain
  UNASSEMBLED; no placeholder or generic command log establishes relinking.
- [ ] Independent full-payload licensing/source correspondence review and actual
  candidate-bound licensingAndSource receipt, including runtime/library obligations
  and Electron/Chromium notice/source obligations as actually assessed. Passing
  bounded archive intake does not establish legal/material completeness.
- [ ] Fresh final-candidate native receipts and reviewed full-payload F1/migration
  applicability/preservation evidence; existing scoped mock/native reports retain
  their limits and cannot silently become release gate records.
- [ ] Authentic public publisher pin, protected signing configuration and explicit
  rollout activation; exact stable signed-asset approval and public release plan.
  No production key is generated or provisioned by integration.
- [ ] Apple code signing/notarization, Gatekeeper/Touch ID entitlements and signed
  Mac full-app install/activation/rollback evidence through protected infrastructure.
- [ ] Confirm project tap/AUR ownership and review/submit exact generated recipes;
  prove authenticated npm ownership for proposed bobs-factory-trial before changing
  its private gate or publishing any launcher. Workspace npm stays private/retired.
- [ ] Physical passkey and actual second-machine access/provider continuation
  acceptance where still required; controlled protocols/software authenticators
  remain explicitly scoped. Real providers require separate credit authorization.
- [ ] Native minimum macOS/glibc/CPU and clean-machine package-manager install/
  upgrade/remove acceptance, login/logout/reboot/lingering and crash/startup proofs
  on isolated hosts. Modern runner success does not prove proposed minimums.
- [ ] Scoped operator GitGuardian reviews38083768/38084076 (four occurrences).
  Preserve sanitization intent and historical evidence; no bypass/history rewrite.

No production/service/home/key changes, signing, publication, tags, catalog
submission, original PR closure or remote merge are authorized by this integration.
