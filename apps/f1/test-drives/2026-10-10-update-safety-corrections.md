# Updater safety corrections — mocked F1

Date: October 10, 2026. Tested source: `ee7befdcc2cd36726df01d19c338e1a4ad4741b8`
on `feat/update-lifecycle-119-120`, draft [PR #86](https://github.com/jappyjan/bobs-factory/pull/86).
Addresses independent review [#116 comment #990](https://taskbot.apps.janjaap.de/p/bobs-factory/t/116).
[#119](https://taskbot.apps.janjaap.de/p/bobs-factory/t/119) and
[#120](https://taskbot.apps.janjaap.de/p/bobs-factory/t/120) remain in progress.

F1 applies to the changed runtime admission/reboot behavior. This supplements,
and does not replace, the historical [initial drive](2026-10-10-update-lifecycle.md).

## Findings and corrections

1. **Operation ownership:** every primary-lock acquisition, stale replacement and
   cleanup is serialized through a separate exclusive reclaim guard. Atomic guard
   records and operation records bind a nonce and actual `ps` process start identity.
   Reclaim rereads the complete original record under the guard; cleanup removes
   only its caller's complete record. Stale guards are recursively recoverable.
   Live legacy PID-only locks fail closed; absent legacy owners remain recoverable.
   Two controlled Node processes contend for one stale production lock; exactly one
   enters work, the loser retains the winner's live record. Additional checks cover
   reused PID/start mismatch, caller-specific cleanup and a stale reclaim guard.

2. **Operator admission:** the worker gives OperatorService the same UpdateDrain
   used by its other listeners. Mutating tools synchronously check maintenance and
   enter accepted-work accounting before any await, leaving after the final mutation.
   Inspection remains available. A persisted-marker check also fences standalone
   service/listener construction. The actual worker-owned OperatorServer rejects
   stop, answer, resume, retry, steer, ticket-sync retry and MCP configuration edits
   after the freeze. A configuration operation admitted before freeze completes its
   controlled awaited write; drain stays non-idle until completion.

3. **Reboot dispatch:** both pending receipt dispatch and the accepted ticket startup
   entry point refuse new execution during maintenance. Admitted startup/preflight,
   preparation and final persistence contribute to drain observations. Exact completed
   maintenance release deliberately resumes Factory recovery and pending dispatch.
   The actual EdgeWorker.start path boots with a persisted maintenance marker and
   pending launch receipt; no preflight, route or receipt mutation occurs until exact
   release. Wrong-ID release does not resume work. Admitted preflight spanning freeze
   finishes naturally and remains counted through routing and final persistence.

4. **Release acknowledgment:** additive schema-1 `transaction.release` records
   `{transactionId, outcome, status}` before release. `status: pending` prevents new
   activation; acknowledgment restores the completed outcome and marks acknowledged.
   Failures retain `recovery-required` with the exact outstanding release. Recovery
   retries release without reacquiring maintenance or repeating healthy activation/
   rollback. Tests cover release failure, lost response, and persisted interruption
   fixtures for succeeded/rolled-back/cancelled legacy terminal transactions without
   acknowledgments. These interruption tests seed durable crash states; they do not
   claim a native supervisor crash trial.

5. **Explicit channels and downgrade consent:** updater discovery disables canonical
   beta fallback and checks the signed manifest channel during conversion, pin
   resolution and staging. Installer default discovery retains its beta fallback.
   Automatic authorization uses the canonical semantic-version comparator, so a
   same-core stable-to-prerelease downgrade needs candidate-bound Install consent.
   Tests cover beta channel rejection, prerelease consent and default-versus-explicit
   discovery after stable verification fails.

## Validation

Required precommit monorepo build and typecheck passed; changed-file Biome and
`git diff --check` passed. No dependencies changed.

```sh
pnpm --filter bobs-factory-edge-worker exec vitest run \
  test/UpdateManager.test.ts test/UpdateOperationLock.test.ts \
  test/UpdateMaintenance.test.ts test/PublishedUpdateSource.test.ts \
  test/MachineCapacity.test.ts test/FactoryServer.test.ts \
  test/TicketTracking.test.ts test/EdgeWorker.workflow-triggers.test.ts \
  test/IntegrationCapacity.test.ts
node --test scripts/tests/release-discovery.test.mjs
```

Results: 167 selected unit/integration tests and five canonical discovery tests
passed. The 20 manager tests were rerun after the final idle-return correction.
Discovery uses the repository's existing controlled fixtures, not production
publisher authentication; it does not exercise PublishedUpdateSource's successful
archive extraction. No production signing keys were created or used.

After the source commit and build, both drives were rerun with its complete SHA:

```sh
mkdir -p /tmp/delivery-updater-fixes-f1-final
F1_AGENT_MODE=mock \
  F1_TESTED_COMMIT=ee7befdcc2cd36726df01d19c338e1a4ad4741b8 \
  F1_EVIDENCE_DIR=/tmp/delivery-updater-fixes-f1-final \
  node apps/f1/test-drives/assets/update-maintenance.mjs
F1_AGENT_MODE=mock \
  F1_TESTED_COMMIT=ee7befdcc2cd36726df01d19c338e1a4ad4741b8 \
  F1_EVIDENCE_DIR=/tmp/delivery-updater-fixes-f1-final \
  node apps/f1/test-drives/assets/update-lifecycle.mjs
```

[New admission/reboot receipt](assets/2026-10-10-update-safety-corrections/update-maintenance.json):
five passes. Constructs and starts an actual EdgeWorker with mock provider handlers,
its actual OperatorServer/OperatorService, UpdateDrain and MachineCapacity. Uses a
synthetic local operator grant and seeded waiting checkpoint. Tracker detail fetches
and the final route are controlled; actual native agents and network work are absent.

[Replacement/preservation receipt](assets/2026-10-10-update-safety-corrections/update-lifecycle.json):
seven passes, peak controlled runtime count one. Production UpdateManager,
UpdateDrain, MachineCapacity, WorkflowRuntime and protected FactoryServer run under
an in-process lifecycle fixture. A real controlled Node descendant exits naturally;
waiting answer/review gates and the mock native session ID survive controlled
replacement and rollback. Native continuation here is a mocked session-ID handoff.

No failing F1 attempt occurred during this correction drive. The old report's
historical harness failures and native limitations are retained unchanged.

## Integration and acceptance still required

Lifecycle must rebase the combined checkout onto this source and honor pending
release receipts in both UpdateSupervisor and OwnedUpdateLifecycle. In particular,
release must accept the exact retained terminal outcome during `recovery-required`,
be idempotent after an already-completed external release, and never repeat rollback
because only a successful activation's release acknowledgment was interrupted.
The updater lane edited no desktop/service/supervisor files.

These checks do not run OwnedUpdateLifecycle, successful signed updater download/
extraction, launchd/systemd/desktop restart, or real native-session continuation.
Remaining acceptance includes the combined owner-specific health/rollback and
bounded restart trials, auth/native-store preservation, final four native targets
and desktop artifacts, packaging/settings handoff, authentic publisher pins,
protected signing, eligible complete public channels and exact publication approval.
No production homes/services, real-agent credits, production signing, publication,
merge or ticket closure occurred. Independent review of the corrected head remains
required before acceptance.
