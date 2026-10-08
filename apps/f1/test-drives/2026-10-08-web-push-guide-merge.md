# Web Push integration with current review-guide behavior

Date: 2026-10-08. Previous PR head: `a512daaf179f8afa5079ef98667a105c32e08d5e`.
Merged base: `58cce00b2ae6a4f2ab2c51f1fdfa8912ba466d6a`.
The tested tree contains the merge resolutions before the merge commit.

## Scope and setup

The merge retains both the Web Push capability guidance and the base's new
review-guide guidance. The complete routing-prompt expectation includes both.
The base's review reader changes are retained without additional UI edits.

Following the canonical F1 skill, the integration drive uses simulated agents,
an isolated Git repository and Factory home, a seeded CLI issue tracker, the
compiled EdgeWorker and a fresh headless browser session. Factory and RPC
listeners use loopback ports 3677 and 3678. Persisted fixture sessions exercise
the existing authentication boundary; no browser passkey ceremony is claimed.
The push sender records payloads instead of contacting a real provider.

Evidence directory (called `E` below):
`/Users/jappy/.cyrus/factory/evidence/manual-56a8faa8-c83d-4083-a81b-b98174357df8`.

## Commands and results

- `pnpm build`: passed (`E/ci-guide-merge-build.log`).
- `env -u BOBS_FACTORY_INTERNAL_EXECUTABLE F1_AGENT_MODE=mock pnpm -r test:run`:
  2,752 tests passed, with two existing skips (`E/ci-guide-merge-all-tests.log`).
- `env -u BOBS_FACTORY_INTERNAL_EXECUTABLE F1_AGENT_MODE=mock node E/ci-guide-merge-push.mjs`:
  passed (`E/ci-guide-merge-f1.log`, `E/ci-guide-merge-results.json`).

The drive asserts unauthenticated push/config rejection, registration of two
devices, test-payload acceptance by the recording sender, issue creation and a
simulated question delivered to both devices. Notification navigation preserves
the destination through sign-in, refreshes the question and discards unsent
answers. Closing Notifications resets its unsent device label. Session revocation
hides private questions and clears private drafts while retaining deferred device
cleanup. A remotely disabled device receives no completion; the other receives
exactly one. Bodyless device deletion succeeds. Restarting push does not replay
consumed transitions. The run completes after the explicit fixture answer.

The inspected screenshot `E/ci-guide-merge-notifications.png` shows the reset
label and usable Notifications controls. The named headless browser session and
both fixture listeners were stopped in the driver's cleanup.

## Limits

This establishes integration and simulated-agent orchestration. It does not
establish real-agent guide quality, native notification receipt/background
delivery, trusted OS clicks, browser passkey ceremonies or production Tailscale
configuration. Existing protected zrok2 QA evidence remains preserved. The
tracker snapshot synchronization discrepancy remains runtime-owned.
