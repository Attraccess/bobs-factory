# Web Push with current input-reset behavior

Validated PR #35 head `6b20658e18469e0ece251fa3fd0fabf783264a00` merged
with main `d6e3ad8322c4e7445de51a0b81e73c932e95be15`, plus the label
reset in this commit. The conflicting PWA tests now preserve main's removal of
input restoration and this PR's notification privacy/navigation coverage.

The merge introduced the mounted-form state helper. Notifications now uses it
for the unsent device label, so closing the dialog discards that edit without
changing registered devices or notification consent. The browser reproducer
failed before the fix with `Unsent device label` still present after reopening;
it passed after the fix with `This browser`.

## Executed workflow

The embedded F1 EdgeWorker uses an isolated home/repository, simulated agents,
a recording push sender and fixture-scoped persisted authentication sessions.
No provider credits or real push-service sends were used. A new named
agent-browser session opened with `--headed false` and closed during cleanup.

Assertions passed for:

- Unauthenticated config/push denial and two authenticated device registrations.
- Test-send acceptance, a tracker-created question delivered to both devices,
  and retention of its recommendation and timeline activity.
- A run destination surviving sign-in; synthetic notification navigation back
  to the run refreshed authoritative state and discarded the prior unsent answer.
- Closing and reopening Notifications discarded the unsent label. A screenshot
  was captured and visually inspected.
- Revocation hid the question and cleared private drafts while preserving consent
  and deferred subscription cleanup.
- A disabled device received no completion; the enabled device received one.
- Bodyless deletion, disabled-device test rejection and remote-session revocation.
- Restarting the push observer did not replay the completed run.

## Reproduction and evidence

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-56a8faa8-c83d-4083-a81b-b98174357df8`.

```sh
F1_AGENT_MODE=mock node <evidence-directory>/ci-input-reset-push.mjs
```

Records: `ci-input-reset-f1-red.log`, `ci-input-reset-f1.log`,
`ci-input-reset-results.json`, `ci-input-reset-activities.json`,
`ci-input-reset-browser.snapshot.txt`, `ci-input-reset-notifications.png`.
The fixture used loopback ports 3677/3678; worker and browser cleanup completed.

The combined repository build and 82 focused tests passed. Repository Biome
passed with 18 existing warnings. The full source-test run first hit a Cursor
filesystem timeout under concurrent load; all 48 Cursor tests passed on the
sequential rerun. The Factory package had 1,458 passing tests and one existing
skip, with 22 failures caused by inherited `BOBS_FACTORY_INTERNAL_EXECUTABLE`:
Node child processes selected binary-only internal commands. All 26 tests in
the two affected files passed with that variable removed for the source run.
Source-test environment correction did not change product code or test limits.
The remaining application suites passed: 135 CLI tests and nine F1 tests.

## Limits

This validates orchestration, authenticated API behavior and browser state.
It does not establish real model output, native notification receipt, trusted OS
focus, physical-device behavior, a browser passkey ceremony or production
Tailscale configuration. Prior accepted HTTPS and native-device limitations
remain recorded. Runtime-owned ticket synchronization was not modified.
