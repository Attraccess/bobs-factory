# Signed delivery and native update integration — Taskbot #116

Date: 2026-10-10. This is controlled runtime evidence, not production release,
publisher trust, platform minimum, package catalog or publication evidence.

## Current result — signed native flow passes

The full controlled drive passes **23/23 scenarios** at exact native source/tooling
`aa0ad1404aed147cf82fc259cf0c11f6bb18753b`, frozen on #116 comment1097 before
preparation. This combines packaging `fecdda18379ebc1cd91b20f63839bb7820fb24b1`,
lifecycle `84f2b98575357ebde3b094967ca0e1bfa72c5aa8` and updater outcome correction
`815c4515ef7bffa09c18ebe7bb31bf197bb55a2e` (including startup967/evidence662).
All six actual darwin-arm64 variants were built once with Bun1.4.2 in a separate
compiler HOME/environment. The passing driver hash is
`ca3784fb34f91837554788276a4336b41fa47c6a0f9dbe91f154364dbaabd085`.

- [Passing signed source/install/native runtime receipt](assets/2026-10-10-signed-delivery/passed-aa0ad-signed-delivery.json)
- [Passing original contention regression with journal preservation](assets/2026-10-10-signed-delivery/passed-aa0ad-startup-contention.json)
- [Passing updater regression with a different previous installed view](assets/2026-10-10-signed-delivery/passed-aa0ad-maintained-startup-contention.json)
- [Retained first attempt: harness confirmation error](assets/2026-10-10-signed-delivery/harness-error-aa0ad-first-attempt.json)

The complete successful path uses real HTTPS and production verification,
discovery, archive staging, extraction, native probes, signed bootstrap/native CLI,
authenticated native drain, the actual external owned supervisor, compatibility
preflight, exclusive stop/link/start/identity health and rollback. All375 release
requests are credential-free. Tampered signature/bytes/inventory/candidate,
missing signature/asset, unknown key and wrong channel are rejected. Explicit
stable cannot silently select beta; only the documented unbound installer default
may use authenticated beta compatibility.

Actual installer provenance grants the new bound ownership capability; changing
its record revokes it while executable bytes remain intact. Real shell reinstall
preserves both overrides, pause and pin. Native CLI/API handoff retains those
values and rejects stale CAS. A real shared-capacity lease and controlled native
process descendant postpone update without being signaled; later release permits
one idle replacement. Post-preflight pause, pin, manual and channel changes cancel
before Stop. Later nightlies activate under the subscribed default, stable holds
under manual default, and its saved idle-auto override permits a newer stable.
Returning from nightly to stable requires exact explicit consent and passes native
state compatibility. Waiting questions/definitions/checkpoint/output, worktree
evidence and test auth/native-store boundary markers survive every replacement.

Both real lost-release-ack paths finish without duplicate activation/PIDs. After
succeeded, the previous native version exits1 before readiness; after rolled-back,
the rejected candidate exits1. Both rejected cold starts preserve their copied
journals byte-for-byte. Recovery retains the completed selected owner. Injected
replacement-health failure rolls back, marks the candidate bad and prevents
repeat activation. Actual signed-bootstrap trial workers coexist in another home,
reject duplicate trials and remove only their temporary runtime on TERM.

Firstaa0 attempt reached rollback recovery after20 passing scenarios, then the
new harness passed explanatory prose to `recover` instead of its required literal
`operation owner stopped`. Production correctly refused. The harness was corrected
with an explicit absent-operation-owner assertion; the same native artifacts then
passed the whole drive. This was a harness error, not a production defect or a
second native build. Historical2e startup failure below remains unchanged.

Updater final `16e60465ed36e18ac45d71db38226dd4b0ccd4e2` / source091 differs from815
only in native test receipt sanitization and report/receipt evidence. Those later
changes do not alter production runtime code. Native identities remainaa0; they
are never relabeled as a later evidence/harness commit. Workspace build/typecheck,
changed-harness Biome/syntax, combined ownership/service tests12/12 and updater
manager/startup tests59/59 passed. No four-target native matrix was repeated here.

This clears this lane's controlled signed-source/install-policy/native-adapter
gap, not epic acceptance. Other targets remain explicit inventory fixtures/not-run.
No actual Electron shell, OS service manager, Homebrew/DEB/AUR/Nix/AppImage,
login/reboot, remote auth or physical native credential/provider continuation trial
is claimed. The native checkpoint ID is mocked and no provider credits were used.
Archive LICENSE/NOTICE/THIRD_PARTY_NOTICES bytes are retained, and the signed fixture
contains exact Factory source. This does not establish complete Bun/WebKit/LGPL
corresponding-source/relink release material. Authentic publisher pins, protected
signing/public channels, eligible stable promotion/digest approval, platform/package
receipts and the separate synthetic-fixture GitGuardian operator review remain
release blockers. No production trust adoption, signing, publication, merge or
ticket status change occurred.

## Applicability and exact inputs

The combined changes affect persisted policy, maintenance admission, workflow
retention, native replacement and recovery. Runtime validation is applicable.
The direct installer/signature controls complement the workflow drive; they do
not replace it. This drive uses actual native binaries, `PublishedUpdateSource`,
canonical `githubClient` / signed release verification, `UpdateManager`,
`OwnedUpdateLifecycle`, the native CLI's actual EdgeWorker/FactoryServer and
authenticated local drain/maintenance API. A real `WorkflowRuntime` prepares a
waiting question with a controlled agent checkpoint. No live provider is used.

Frozen input ancestry:

- Packaging PR84: `fecdda18379ebc1cd91b20f63839bb7820fb24b1` (review1035).
- Updater PR86: `46ec4a6e5671174bf9dfda601b7e2853eb8194c1`, production source
  `9717247b5429516ad0fa27f36d267c25ec8e57dc` (review1050).
- Initial lifecycle PR85 `e93c15d1f741541fca29e337b201e0b3babad9ac` was superseded
  before acceptance tests by `0dac1415b0a942fd353ba47efd0ac993aa10a7cc`.
- Provisional combined `42873edfe82becd3dc3e4161f53a12ebf8060da4` retained in history.
  Its artifacts are not relabeled as final evidence.
- Tested combined production source/tooling:
  `2e47c11ab00fd51fe7c87eda9693b3709e26b7e6`, recorded on #116 before tests.
  Isolated branch `test/signed-delivery-integration-116`, worktree
  `/tmp/bobs-factory-signed-integration-116`. No active lane or main changes.

Native darwin-arm64 builds use `npm exec --yes --package=bun@1.4.2 -- bun
scripts/build-binary.ts` with canonical frozen candidates, clean source/tooling,
and isolated version override. Versions1101/1102/1103, stable1.0.0 and beta1.0.0
were built locally. Exact source, candidate digests, archive/sidecar sizes and
hashes, runtime hashes and Bun version are in the retained receipt.

## Observed drive — failed source 2e47c11a

The first full actual signed-source/native drive passed sixteen scenarios before
an integrated stable-return failure. Retained evidence:

- [Failed signed runtime drive](assets/2026-10-10-signed-delivery/failed-2e47-signed-delivery.json)
- [Deterministic native startup contention](assets/2026-10-10-signed-delivery/failed-2e47-startup-contention.json)

Successful behavior before failure:

- Actual TLS-verified loopback GitHub repository/list/tag/assets/ref responses;
  credential-free canonical client; ephemeral RSA3072 TEST pin authenticates exact
  manifest bytes and byte-bound inventory/candidate before real native extraction.
- Actual archive installer and native version probe. LICENSE, NOTICE and complete
  generated THIRD_PARTY_NOTICES bytes match the built archive after staging.
- Rejection of unknown pin, changed manifest signature, missing signature,
  partial target inventory, missing asset, changed archive response, mismatched
  frozen candidate and wrong requested channel. Explicit updater stable rejects
  beta while the separately documented unbound installer default permits it.
- Real shell `--home` handoff to actual native `update settings`. Both channel
  overrides, pause and pin survive explicit reinstall and ordinary default
  reinstall; only deliberate channel choice changes the selected channel.
- Offline source failure remains visible and a later controlled check recovers.
- Explicit initial same-core stable-to-nightly Install consent, then a later
  signed nightly activates automatically with no new consent under nightly's
  saved default. Actual old PID exits before link switch; new PID acquires the
  same home; authenticated identity and preservation health succeed.
- Post-native-preflight pause, pin and manual changes cancel before Stop. Manual
  nightly holds until candidate/revision-bound explicit Install. Lost exact
  maintenance-release acknowledgment recovers on a fresh actual lifecycle,
  retaining the successful new PID and without a second activation.

The native worker retains waiting workflow status, frozen definitions, checkpoint,
outputs, questions and question batch, worktree evidence, a test auth marker and
test native-store sentinel. The checkpoint session ID is mocked; this does not
claim real coding-agent conversation continuation or real credential/keychain use.

### Confirmed startup race

During explicit signed nightly1103 to stable1.0.0 return, activation succeeds but
native startup fails in `FactoryServer` constructor. `observeInstalled` acquires
`updates/state.lock` even for the supervisor's nonterminal transaction, competing
with supervisor phase persistence after `OwnedUpdateLifecycle.start` observes
worker ownership. Error: "Update settings are being saved; retry. Inspect a
retained state.lock after interruption." Health times out. Actual bounded rollback
restores nightly1103; exact `rolled-back` release is acknowledged. This is failed
stable-return acceptance, not a passing update.

Deterministic regression holds the exact live fixture caller's writer lock briefly
across native worker ownership and constructor initialization, then removes only
its unchanged record after500ms. Native startup exits1 before health. No stale lock
is cleared and no unrelated process is signaled. Sites: FactoryServer.ts:129,
UpdateManager.ts:261–266 and its writer at226–235. Reported on #116 comments1064,
1067; coordinator assigned correction to the updater lane. Integration makes no
production module correction.

The earlier attempt that expected automatic initial stable-to-same-core-nightly
activation was a fixture expectation error. Production correctly required explicit
downgrade consent. Corrected sequencing passed; the later constructor race above
is independently reproducible and is retained as a product failure.

A subsequent separate check on the same provisional2e47 native bytes passes the
real HTTPS signed bootstrap into an actual trial worker beside an independently
owned worker. Both own different state homes/PIDs. TERM of the just-spawned trial
launcher cleans its temporary runtime and trial ownership, while the original
worker retains the same PID. [Provisional coexistence receipt](assets/2026-10-10-signed-delivery/provisional-2e47-trial-coexistence.json).
It is deliberately not relabeled as corrected final-flow or OS service evidence.

A separate controlled native CLI/API handoff at the same2e47 bytes also passes:
both saved channel overrides, pause and pin appear in the authenticated API;
an API edit appears in native CLI status; an old revision is rejected and the
saved defaults can be restored through the API. The full final driver includes
this check. This provisional check does not clear the failed replacement flow.

## Reproduction harness

After freezing a corrected clean combined tree, prepare native fixtures once:

```sh
pnpm install --frozen-lockfile
node scripts/prepare-signed-delivery-fixture.mjs /tmp/signed-delivery-BUILD_SHA
node scripts/tests/signed-delivery-runtime.mjs /tmp/signed-delivery-BUILD_SHA /tmp/signed-delivery-BUILD_SHA/receipts
node scripts/tests/integration-native-startup-contention.mjs /tmp/signed-delivery-BUILD_SHA/build-stable/bobs-factory-1.0.0-darwin-arm64/bobs-factory /tmp/signed-delivery-BUILD_SHA/startup-contention.json
```

The preparer requires an empty external output and clean source/tooling. It builds
only the current native target with Bun1.4.2, not the four-target CI matrix. Local
nightly sequences and stable promotion origins are TEST fixtures, not public
publication eligibility or approved stable promotion. The final expanded harness
also checks a live descendant lease, channel race, automatic stable upgrade and
actual trial-worker coexistence; those additions had not run at the failed2e47
checkpoint. Future results must be recorded separately without erasing failure.

The fixture remaps canonical repository/asset URLs only in the injected test
transport and temporary curl wrapper. Real HTTPS verifies a disposable local TLS
certificate; no insecure TLS flag. Publisher private key exists only in memory;
TLS keys are deleted after the drive. Native binaries keep production pins
unchanged. Other target inventory files explicitly say not-run and required
release-receipt slots explicitly say TEST ONLY/not-run. They are not passed
publication receipts. Source transport carries the exact Factory git archive;
this is not a complete reviewed Bun/WebKit/LGPL relink/source bundle.

## Other checks and remaining acceptance

On2e47: required workspace build/typecheck pass;35 discovery/bootstrap/launcher
tests and22 UpdateManager/PublishedUpdateSource tests pass. Changed harness Biome
and syntax checks pass. These do not erase the native startup failure.

No production homes, services, provider credits, publisher key adoption, OS
signing/notarization, publication, merge or ticket status change. Four-target
desktop/service CI and independent lifecycle review remain owned by the other
lanes. Real native-agent continuation, OS login/reboot/service/desktop passkey
trials, package-manager/AppImage installations and public npm/catalog ownership
remain distinct gates. Authentic reviewed publisher pins, protected signing,
complete public channels, reviewed full-payload release evidence and explicit
publication approval remain operator prerequisites.
