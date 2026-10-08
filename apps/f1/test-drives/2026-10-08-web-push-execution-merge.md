# Web Push and execution-profile integration

Validated the merge of PR #35 head `94ad93b6c6245b576636e6e8c576edf89252de54`
with fetched main `4912b9cba41202dbeaa262016e57f4753a8ee124` on 2026-10-08.
This report is committed with the merge resolutions.

The merge retains intentional-stop metadata alongside accepted execution
snapshots, both protected server hooks, Web Push guidance and execution-profile
guidance. Complete routing prompt assertions remain intact.

## Executed F1 and browser checks

The embedded EdgeWorker used fresh temporary repository/home directories,
CLI issue tracking, `F1_AGENT_MODE=mock`, injected `MockAgentRunner` handlers,
disabled background titles and a recording push sender. No live provider turn
or real push send ran. The headless Chromium session was created for this drive
and closed in cleanup; the worker and its loopback servers were stopped.

- Created a CLI issue/session with a real isolated worktree. The simulated
  question reached tracker activities and both registered devices exactly once.
- Created a prepared run with an explicit private execution snapshot. It
  completed with the selected identity/tools retained in persisted run state;
  each device received one completion transition. This checks execution and
  notification integration, not remote account authentication or root worktree
  admission for a private profile.
- Unauthenticated push/config access returned 401. Authenticated registration,
  recorded test delivery, disable and bodyless deletion succeeded. A disabled
  device received no subsequent ticket completion alert.
- Headless browser checks preserved the requested destination through sign-in,
  refreshed the question after synthetic notification navigation and discarded
  unsent answers on navigation. Closing Notifications cleared unsent device
  labels. All six Settings sections and the selected identity were visible;
  Notifications remained usable from Settings.
- Session revocation hid protected questions, retained device opt-out/deferred
  cleanup and cleared private drafts. Remote revocation rejected push access.
  Restarting push bookkeeping did not replay existing attention or completion.

## Evidence and commands

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-56a8faa8-c83d-4083-a81b-b98174357df8`.

- Driver: `ci-execution-merge-push.mjs`
- Receipts: `ci-execution-merge-results.json`,
  `ci-execution-merge-activities.json`, `ci-execution-merge-f1.log`
- Inspected screenshots: `ci-execution-merge-settings.png`,
  `ci-execution-merge-settings-notifications.png`
- Command: `env -u BOBS_FACTORY_INTERNAL_EXECUTABLE F1_AGENT_MODE=mock node <evidence-directory>/ci-execution-merge-push.mjs`

Initial fixture setup attempts exposed the private profile's strict failed-fetch
and unbound-remote rejection. The final drive separates ticket/worktree coverage
from a prepared explicit-profile run. A missing fixture trigger origin was
corrected before the final passing run. No product change was needed for those
fixture corrections.

## Other validation

- `pnpm build` and `pnpm typecheck` passed.
- `env -u BOBS_FACTORY_INTERNAL_EXECUTABLE pnpm -r test:run` passed
  2,849 tests with two existing skips. The initial inherited packaged-launch
  variable made five title-MCP tests invoke Node with binary-only arguments;
  they passed when the checkout test process used its normal launch environment.
- `pnpm biome ci` passed with 19 existing warnings.
- `git diff --check --cached origin/main` passed. Historical reports imported
  from main retain their intentional Markdown hard-break whitespace.

## Limits

Persisted fixture sessions simulate authentication; no browser passkey ceremony
ran. Recording-sender success does not establish push-provider acceptance,
physical-device delivery or trusted OS notification clicks. Production Tailscale
configuration remains unverified. Simulated agents establish orchestration, not
real model reasoning. The tracker snapshot discrepancy remains a limitation;
this drive made no tracker lifecycle changes. Historical accepted evidence and
limitations remain preserved.
