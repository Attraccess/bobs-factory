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
- [Focused bounded-shutdown and temporary-fixture cleanup regressions](assets/2026-10-10-signed-delivery/passed-aa0ad-harness-regressions.json)
- [Focused native startup-contention rerun with generator digest](assets/2026-10-10-signed-delivery/passed-aa0ad-focused-startup-contention.json)

## Harness review follow-up — separate from the 23/23 drive

The first independent review of PR87 found three harness/evidence issues. The
first follow-up at `c346f5aa0a0694c90b17be723d9349d5741f8b07` recorded the
following fixes and checks, without changing product code or historical receipts:

- Timed child processes now receive TERM, then KILL after a bounded grace period;
  POSIX launches use an owned detached process group so descendants are stopped
  with the child. The helper reports timeout, forced termination and close-timeout
  state, and a timed-out command cannot report exit code zero as success.
- New startup-contention receipts include the SHA-256 of the exact generating
  script. The focused native rerun is bound to source `aa0ad1404aed147cf82fc259cf0c11f6bb18753b`,
  darwin-arm64 executable SHA-256 `cb1b58234415bd445d776eedb8e6d804e186e9fe3fe767a94bef0b492a7458cd`,
  and generator SHA-256 `ce0a421465f1c1b809265f1cf9297dcdccec4e363a287fea15847782f63fedcb`.
- Signed-runtime and contention fixture trees are removed only after their
  receipts are written. Cleanup verifies the harness-owned temporary path; an
  explicit `--retain-fixture` keeps it, and a receipt stored within the fixture
  prevents deletion. The focused isolated regression receipt exercises cleanup
  after both passing and failing receipts, verifies that a TERM-ignoring child
  and descendant are reaped within bounds, and confirms another process group is
  left alive. Its recorded runtime-driver SHA-256 is
  `8407c8fe53bc049323198a97fe56c8f1604fa4acb748c2ac66b14bf311e1209a`.

These targeted checks do not rerun or change the original 23/23 result. That result
remains bound to its original driver SHA-256
`ca3784fb34f91837554788276a4336b41fa47c6a0f9dbe91f154364dbaabd085`. The two
pre-existing contention receipts and all historical failures are retained as-is;
only the new focused native receipt claims the new generator digest. No native
rebuild, full-drive rerun, provider, signing key, production service or credential
was used for this follow-up.

### Round 2 — leader-exit cleanup and receipt finalization

The second review found two remaining P2 harness failures: cleanup stopped when
only the leader had closed, and a fixture-removal exception could leave a receipt
with `passed: true` despite a failed process. Both are corrected separately from
all earlier native evidence.

The command wrapper now owns its timeout instead of also passing it to Node's
`spawn` (which could TERM the leader before cleanup captured group ownership).
Cleanup captures the detached group's PID/start-time identities while its leader
is live, verifies a surviving known identity before signaling, stops using a PGID
once the group is gone, and refuses changed or unestablished ownership. It waits
for both the owned live group and leader close, escalating surviving descendants
within the TERM/KILL bounds even after the leader exits. A real TERM-responsive
leader plus TERM-ignoring descendant now reports `forcedKill: true`,
`closeTimedOut: false` and timeout code124; both PIDs are gone while an unrelated
process group remains alive. The existing both-ignore-TERM case also passes.

Signed-runtime receipt finalization writes the run's receipt before tree removal,
catches removal exceptions, records error code/stack, sets `passed: false`, then
rewrites that same receipt. The driver subsequently fails its cleanup-error guard.
A focused subprocess injects EACCES at the actual removal boundary, exits1, and
leaves a failed diagnostic receipt and fixture marker; a separate historical
receipt stays byte-for-byte unchanged. Checks also preserve explicit retention,
receipt-inside-fixture retention, and failed/retained finalization after a recorded
fixture-close error. The runtime driver's existing close-error catch still feeds
its cleanup-error list; its trial cleanup helper import is now explicit.

[Round-2 focused harness receipt](assets/2026-10-10-signed-delivery/passed-round2-harness-regressions.json)
records **9 passing focused checks** and these exact generator bindings:

- Regression script: `a1adeee5476293659b2160b7d1d9bbf8510627f256cbf67a0fc4cb7fc2748bf8`.
- Process fixture helper: `93fd1b5e3c09e85b8cb606c5ac0c94d9b567f7726e6a11190cc0c540e4aab2ca`.
- Runtime driver: `20f984aa3680bee0cdb73f16e820c4eaac369efb0407d93feb7c109da4413dd8`.
- Lifecycle/finalization helper: `34910ad8dadc177007d348c356c93a618a49c05061f9ffba922603f8a814f29e`.

Command: `node scripts/tests/signed-delivery-harness-regressions.mjs apps/f1/test-drives/assets/2026-10-10-signed-delivery/passed-round2-harness-regressions.json`.
Focused Biome, JavaScript syntax and diff checks pass. This changes delivery test
helpers rather than F1 product orchestration; no new issue-tracker/agent F1 drive
is applicable. No 23-scenario rerun, native build or second native contention
rerun occurred. The original23 driver hash, the first aa0 harness error, the 2e47
product failure, both historical contention receipts and the one separately
recorded native contention rerun remain unchanged. No real provider/native
credential, other-platform, OS-service, Electron or complete licensing/release
acceptance is claimed. GitGuardian synthetic incidents38083768 and38084076 remain
an operator gate; no bypass, publisher/signing key adoption or publication.

### Round 3 — nonpassing provisional receipts and final-write failures

Independent round-3 review cleared process-group ownership/descendant cleanup,
but found that round-2 finalization could persist PASS before removal, then fail
both cleanup and the final receipt rewrite. The round-3 helper now persists
`passed: false`, `finalization: "pending"` before cleanup. It publishes the run's
passing outcome only after cleanup and a successful final atomic write. The
same-directory temporary-file/rename writer prevents a failed write from
truncating the pending receipt. No fallible filesystem operation follows a
successful rename. Initial/final write failures record EACCES/stack in memory,
keep `passed: false`, set `finalization: "failed"`, and throw for nonzero exit.
When persistence is unavailable the disk receipt stays explicitly pending and
nonpassing; it cannot claim to contain diagnostics that could not be written.

[Round-3 focused receipt](assets/2026-10-10-signed-delivery/passed-round3-harness-regressions.json)
records **14 passing focused checks**: the previous nine plus initial-write
failure, final-write failure alone, cleanup plus final-write failure, and atomic
successful finalization of both passing and failing run outcomes. The combined
failure makes the initially writable receipt read-only in the removal callback,
then injects EACCES at the actual writer boundary (robust even under Linux root).
All three write-failure subprocesses exit1. Memory is failed; disk is pending and
nonpassing for final-write failures, or absent for initial-write failure. The
combined failure retains both cleanup/write diagnostics and the fixture marker;
a separate historical receipt remains byte-identical. Explicit retention,
receipt-inside-fixture and recorded close-error semantics still pass. Previously
cleared owned-process cleanup is unchanged.

Current focused generator SHA-256 bindings:

- Regression script: `f9845fe0e65aa700822680973b2515bb40b52678b44a948a04914e83b88b6531`.
- Process fixture helper: `93fd1b5e3c09e85b8cb606c5ac0c94d9b567f7726e6a11190cc0c540e4aab2ca`.
- Runtime driver: `20f984aa3680bee0cdb73f16e820c4eaac369efb0407d93feb7c109da4413dd8`.
- Lifecycle/finalization helper: `c3d4eb57065708c6648f6fcf6fa249af968c3c016ab261404a0f28af33e5abb1`.

Command: `node scripts/tests/signed-delivery-harness-regressions.mjs apps/f1/test-drives/assets/2026-10-10-signed-delivery/passed-round3-harness-regressions.json`.
These hashes bind current focused checks only. The historical 23/23 native run
remains source `aa0ad1404aed147cf82fc259cf0c11f6bb18753b`, driver
`ca3784fb34f91837554788276a4336b41fa47c6a0f9dbe91f154364dbaabd085`;
its receipt and every pre-round3 receipt are verified byte-identical to `c0808c1`.
Round-2's nine-check receipt remains historical, not relabeled with current hashes.
No full23 rerun, native rebuild or native contention rerun occurred. Only delivery
evidence helpers changed; no issue-tracker/agent F1 drive applies. Physical
providers/native credentials, other platforms, Electron, OS services, complete
licensing/release material and public trust remain unverified separate gates.
GitGuardian incidents38083768/38084076 remain for operator review without bypass.

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
