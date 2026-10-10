# Signed delivery and native update integration — Taskbot #116

Date: 2026-10-10. This is controlled runtime evidence, not production release,
publisher trust, platform minimum, package catalog or publication evidence.

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

## Reproduction harness

After freezing a corrected clean combined tree, prepare native fixtures once:

```sh
pnpm install --frozen-lockfile
node scripts/prepare-signed-delivery-fixture.mjs /tmp/signed-delivery-BUILD_SHA
node scripts/tests/signed-delivery-runtime.mjs /tmp/signed-delivery-BUILD_SHA /tmp/signed-delivery-BUILD_SHA/receipts
node scripts/tests/native-update-startup-contention.mjs /tmp/signed-delivery-BUILD_SHA/build-stable/bobs-factory-1.0.0-darwin-arm64/bobs-factory /tmp/signed-delivery-BUILD_SHA/startup-contention.json
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
