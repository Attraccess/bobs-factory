# Update startup honors completed release outcomes

Date: October 10, 2026. Tested source:
`09173e8765867e8ef87db8a8e2664687688e4c72`, pushed to
[PR #86](https://github.com/jappyjan/bobs-factory/pull/86).
This supplements the historical [startup contention drive](2026-10-10-update-startup-contention.md)
and preserves its earlier failure and correction evidence.

## Correction

When an external maintenance-release acknowledgment is lost, the updater retains
the completed outcome while moving the transaction to `recovery-required`.
Startup now follows that outcome: `succeeded` requires the candidate runtime;
`rolled-back` and `cancelled` require the previous runtime. Both binaries remain
possible only for unresolved activation/recovery without a completed outcome.
Observation preserves the journal and validates the retained staged candidate.

## Verification

- `pnpm --filter bobs-factory-edge-worker exec vitest run test/UpdateManager.test.ts test/FactoryServer.update-startup.test.ts` — 59 tests passed. Tests exhaust eight transaction phases against all three durable outcomes, assert both accepted and rejected identities, and exercise actual reconciliation through lost release acknowledgments after success, rollback, and cancellation.
- `F1_AGENT_MODE=mock F1_TESTED_COMMIT=09173e8765867e8ef87db8a8e2664687688e4c72 F1_EVIDENCE_DIR=/tmp/delivery-updater-outcome-native-final node apps/f1/test-drives/assets/update-lifecycle.mjs` — 10 assertions passed; peak controlled workers: one. The drive preserves its waiting answer/review gate and mock native session identity during replacement and rollback.
- Built the actual `darwin-arm64` native executable with pinned Bun 1.4.2, then ran `scripts/tests/native-update-rollback-outcome.mjs` in isolated temporary homes. With pending `rolled-back` acknowledgment, the wrong candidate exited before serving with the outcome mismatch; the correct previous runtime became healthy. Both runs preserved `updates/state.json` byte-for-byte. The local native build is unsigned; SHA-256: `42e6504d556ce063bc3fce021f520042a4ab9125cd126a05ed0b0f2e71b5c45b`.
- Required pre-commit monorepo build/typecheck, changed-file Biome, native script syntax and `git diff --check` passed.

Receipts: [mocked lifecycle](assets/2026-10-10-update-outcome-startup/update-lifecycle.json),
[native startup outcomes](assets/2026-10-10-update-outcome-startup/native-rollback-outcome.json).

This proves the updater manager and one packaged macOS target. It does not replace
the separately owned combined signed-flow rerun, multi-target native acceptance,
or lifecycle/desktop review. No production homes/services, provider credits,
signing, publication, merge or ticket closure were used.
