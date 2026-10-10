# Updater startup contention correction — native and mocked F1

Date: October 10, 2026. Production/test source:
`967e09034a8d3dd924e3587d4888fbf7c358836f`, pushed before this evidence-only commit.
Draft [PR #86](https://github.com/jappyjan/bobs-factory/pull/86);
[Taskbot #116 comments #1064/#1066/#1067](https://taskbot.apps.janjaap.de/p/bobs-factory/t/116),
[#119](https://taskbot.apps.janjaap.de/p/bobs-factory/t/119) and
[#120](https://taskbot.apps.janjaap.de/p/bobs-factory/t/120) remain open.

The combined signed delivery drive at
`2e47c11ab00fd51fe7c87eda9693b3709e26b7e6` activated the requested stable return,
then replacement startup crashed while observing its installed identity under a
legitimate updater writer lock. Its bounded rollback succeeded. This new native
failure supplements the earlier source review and does not invalidate or replace
historical updater safety/transport evidence.

## Correction

FactoryServer awaits packaged identity observation in Fastify's startup lifecycle.
The observer validates exact version/commit/target against the intended transaction
phase and staged candidate. Supervisor-owned observations never write the installed
view or journal, including rollback and unacknowledged terminal outcomes. Identical
installed observations also need no write. Any necessary mutation rechecks current
state under the exclusive writer lock before writing.

Only writer-lock EEXIST contention retries asynchronously, for at most one second
with 25ms intervals. Persistent contention defers nonessential observation with the
retained `state.lock` inspection diagnostic; the observer never reclaims or deletes
another owner's lock. Invalid identity, schema, state paths and other filesystem
errors remain startup failures. Operator settings CAS retains immediate contention
and stale-revision rejection.

This lane changed no lifecycle adapter/service/desktop/packaging implementation.
The complementary lifecycle correction in #116 comment #1066 must still await
bounded authenticated `/api/version` readiness and exact live executable ownership
before returning from start.

## Consequential regressions and checks

59 distinct tests across six suites passed in focused runs:

```sh
pnpm --filter bobs-factory-edge-worker exec vitest run \
  test/UpdateManager.test.ts test/FactoryServer.update-startup.test.ts \
  test/FactoryServer.test.ts test/UpdateMaintenance.test.ts \
  test/UpdateOperationLock.test.ts test/PublishedUpdateSource.test.ts
```

New tests cover exact starting/health/rollback observation while a live writer owns
state.lock; byte-for-byte journal preservation; legitimate transient retry;
a supervisor transaction appearing during contention; bounded retained-lock
inspection; unchanged policy revision/CAS; genuine schema and phase-identity errors;
and protected API readiness through FactoryServer's awaited startup hook.
Required precommit monorepo build/typecheck, changed-file Biome, script syntax and
`git diff --check` passed. No dependencies changed. The first new API fixture used
the wrong Host authority and correctly received 403; explicit configured Host
headers corrected that fixture, and all three startup API tests pass.

## Native FAIL → PASS

[Historical FAIL](assets/2026-10-10-update-startup-contention/native-startup-historical-fail.json)
retains the integration owner's original receipt values (repository formatting only): actual signed candidate
`2e47c11a`, executable SHA-256
`0af142f0a49f89780e32dfbd6f064ee2f7e23884a4fec0edeea20b3dbbbb5bb6`,
healthy false, exit 1, retained original contention stack.

Built this lane's clean corrected native executable using isolated pinned Bun:

```sh
npm exec --yes --package=bun@1.4.2 -- bun run scripts/build-binary.ts \
  --target darwin-arm64 \
  --output /tmp/delivery-updater-startup-fix-evidence/native-build
```

The local native test build is unsigned; no publisher signing was performed.
Exact corrected executable SHA-256:
`88447d3fe365f7d179db6b6e6281a1a9225c4bbfd6618b779dd8022140198e30`.

```sh
node scripts/tests/native-update-startup-contention.mjs \
  /tmp/delivery-updater-startup-fix-evidence/native-build/bobs-factory-1.0.0-beta-darwin-arm64/bobs-factory \
  /tmp/delivery-updater-startup-fix-evidence/native-startup-pass.json
node /tmp/bobs-factory-signed-integration-116/scripts/tests/native-update-startup-contention.mjs \
  /tmp/delivery-updater-startup-fix-evidence/native-build/bobs-factory-1.0.0-beta-darwin-arm64/bobs-factory \
  /tmp/delivery-updater-startup-fix-evidence/original-native-startup-pass.json
```

[New maintained native regression](assets/2026-10-10-update-startup-contention/native-startup-pass.json)
passes actual API health, normal live-owner lock removal, and byte-for-byte journal
preservation with a different previous installed identity. It chooses an available
local port and a fresh home. The [unchanged integration reproducer](assets/2026-10-10-update-startup-contention/original-native-startup-pass.json)
also passes against the exact corrected native bytes; its original source/fixture
was only read, and its output uses this lane's own temporary directory. Native
children exited after SIGTERM cleanup. No integration workers were touched.

## Relevant mocked F1

F1 applies to replacement startup/runtime recovery. Production UpdateManager,
FactoryServer, WorkflowRuntime, UpdateDrain and MachineCapacity exercise replacement
and rollback while a controlled live writer owns state.lock. The development F1
build has no packaged identity, so its onReady fixture supplies the exact controlled
identity; the native trial above separately exercises compiled packaged startup.

```sh
F1_AGENT_MODE=mock F1_TESTED_COMMIT=967e09034a8d3dd924e3587d4888fbf7c358836f \
  F1_EVIDENCE_DIR=/tmp/delivery-updater-startup-fix-evidence \
  node apps/f1/test-drives/assets/update-lifecycle.mjs
F1_AGENT_MODE=mock F1_TESTED_COMMIT=967e09034a8d3dd924e3587d4888fbf7c358836f \
  F1_EVIDENCE_DIR=/tmp/delivery-updater-startup-fix-evidence \
  node apps/f1/test-drives/assets/update-maintenance.mjs
```

[Replacement receipt](assets/2026-10-10-update-startup-contention/update-lifecycle.json):
ten passes, including three new starting/rollback contention assertions, API health,
protected update access, unchanged installed view, retained waiting answer/review
checkpoints and mock-native continuation. Peak controlled worker count one.
[Admission/reboot receipt](assets/2026-10-10-update-startup-contention/update-maintenance.json):
all nine existing admission/transport/drain assertions pass. Both final receipts
bind the complete source SHA. An initial lifecycle smoke also passed before the
SHA-labelled evidence rerun. No F1 assertion failed.

## Remaining gates

The integration owner must combine this checkpoint with the lifecycle correction
and rerun the complete actual signed delivery flow, including stable return.
This lane's native proof is darwin-arm64 startup only, not final signed release
validation, OS-service/desktop acceptance, four-target acceptance or real-provider
conversation continuation. Independent review of this focused correction and the
final combined lifecycle/native payload remains required. Earlier signed flow
successes and its historical rollback/failure remain the integration owner's evidence.

No additional delegation, production home/service actions, provider credits,
credentials/private keys, signing, publication, merge or ticket closure occurred.
