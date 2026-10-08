# Web Push integration with Factory passkeys

Date: 2026-10-07. PR [#35](https://github.com/Attraccess/bobs-factory/pull/35).
Tested prior head `fba48f13` with the merge of main `9badbae6` and the
conflict resolutions included in this commit. Historical reports are retained.

## Changed behavior and expected results

Main now requires passkey sessions for Factory on every address. Web Push APIs
must use those same guards. Notification destinations must survive sign-in and
refresh current state; session loss must hide protected content and reject late
push responses. Device consent, independent disable/removal and fresh-only
notification delivery must remain intact.

The merged server retains main's authentication and exact-origin checks, adds
push routes behind them, and uses one origin configuration. The client handles
push 401 responses through the shared authentication state and rejects responses
from a previous session. Both capability descriptions and full-prompt assertions
are preserved. Main's dependency cleanup is retained; the frozen install and
`pnpm audit` passed with zero advisories, so the previous exception is no longer
needed for this dependency graph.

## Executed workflow and browser results

An embedded F1 EdgeWorker used a fresh temporary repository and home, with
Factory on loopback port 3667 and the fixture RPC listener on loopback port 3668.
`F1_AGENT_MODE=mock` and injected MockAgentRunner handlers covered every runner.
The first reply returned a question/recommendation, and its continuation returned
an empty questions array. All provider usage was simulated, with zero cost.

- Unauthenticated push and configuration reads returned 401.
- Fixture-scoped persisted sessions authorized two independent device registrations
  and a test using a recording sender. These sessions are explicitly test data;
  browser passkey ceremonies were not executed by this drive.
- A CLI fixture issue/session reached its question gate. Its recommendation and
  activity output were retained; both devices received the fresh question event.
- A fresh explicitly headless agent-browser session opened the run link signed
  out. The sign-in screen retained the destination. After adding the fixture's
  HttpOnly local session cookie, the refreshed question appeared at that route.
- Notifications rendered behind authentication. Revoking the browser session
  returned to sign-in and removed the protected question from the page.
  Local opt-out and deferred device cleanup survived, while private draft storage
  was cleared. Device preferences contain no subscription keys or run data.
- Disabling the second device and submitting an authenticated answer completed
  the workflow. Only the remaining enabled device received completion.
- Bodyless device deletion succeeded. Testing the disabled device was rejected.
  Revoking the remote fixture session returned push status to 401.
- Recreating the persisted push observer established a restart baseline without
  replaying consumed events. Both listeners and the named browser session stopped.

Focused validation: 105 tests passed across push, notifications, access,
authentication, server, client, PWA and complete routing-prompt suites. Additional
regressions cover expired push sessions and late responses after sign-out. Server
API tests use the real passkey verifier with a software cryptographic authenticator
for both current and legacy origin environment settings, then verify revoked
sessions cannot register, update, remove or test subscriptions.

Commands:

```sh
pnpm install --frozen-lockfile
pnpm audit --json
pnpm build
pnpm --filter cyrus-edge-worker test:run test/FactoryServer.test.ts test/FactoryNotifications.test.ts test/FactoryPush.test.ts test/FactoryAuth.test.ts test/FactoryAccess.test.ts test/FactoryWebClient.test.ts test/FactoryPwa.test.ts test/prompt-assembly.routing-context.test.ts
F1_AGENT_MODE=mock node <evidence-directory>/ci-passkey-push.mjs
```

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-56a8faa8-c83d-4083-a81b-b98174357df8/`.
Driver, timestamped `ci-passkey-results.json`, activities, logs, audit result and
`ci-passkey-signed-out.png` / `ci-passkey-notifications.png` are retained there.
Initial fixture corrections involved canonical localhost, distinct session tokens,
the answer API schema and the required empty questions array; final assertions
passed with a fresh browser session.

## Repository checks

Repository suite coverage completed across all packages, CLI and F1. The initial
parallel command stopped at an existing Cursor five-second timeout; all 44 Cursor
tests passed alone. The remaining suites passed except local CLI release-script
timeouts. A single-worker CLI run passed 11 files; the remaining 16 release
publication fixture tests passed with `--testTimeout=15000` for local diagnosis.
No repository timeout, CI rule or release behavior was changed. The normal remote
CI gates remain required. Biome passed with 29 existing warnings.

## Limits

Recording sends do not establish native delivery or a trusted OS notification
click. This delta checks loopback browser/authentication integration and configured
remote-authority HTTP guards, not a new HTTPS deployment or production Tailscale
ACLs. Prior authorized zrok2 HTTPS evidence remains historical. Physical-device
background delivery and the tracker snapshot synchronization discrepancy remain
unverified. No real agent CLI/API or user desktop browser was invoked.
