# Factory Web Push device cleanup and notification images

Date: 2026-10-07. Tested `8f837227c1b7a02587cfd81813b1154b45b086b1`
plus the QA corrections in `web/notifications.ts` and `web/sw.js`.
Factory web build: `e4779c9272ea8e2be6f2799b`.
PR: [#35](https://github.com/Attraccess/bobs-factory/pull/35), kept draft.

The corrections affect browser device management and notification rendering.
The scoped F1 fixture exercises the existing issue/session/activity path alongside
the real Factory device API and browser UI. Agent hooks are deterministic mocks,
`F1_AGENT_MODE=mock` is set, and the sender records payloads without contacting a
push provider. No live agent calls or production ticket mutations were made.

## Commands and evidence

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-56a8faa8-c83d-4083-a81b-b98174357df8`.

```sh
pnpm --filter cyrus-edge-worker test:run test/FactoryNotifications.test.ts test/FactoryPwa.test.ts test/FactoryServer.test.ts test/FactoryPush.test.ts
pnpm --filter cyrus-edge-worker build
pnpm --filter cyrus-edge-worker typecheck
F1_AGENT_MODE=mock node <evidence-directory>/qa-fix-fixture.mjs
F1_AGENT_MODE=mock node <evidence-directory>/qa-fix-f1.mjs
agent-browser --headed false --session qa69-fix-20261007 open http://127.0.0.1:3597
node <evidence-directory>/qa-fix-worker.mjs
node <evidence-directory>/qa-fix-browser.mjs
```

The fixture used a fresh home `/tmp/qa69-fix-home-20261007` and repository
`/tmp/qa69-fix-repo-20261007`, with Factory on loopback 3597, F1 RPC on 3600,
and fixture-only controls on 3598. Playwright connected only to the fresh
headless agent-browser session. Browser permission/subscription adapters model
two profiles without claiming real notification receipt.

## Results

- The new Fastify-parser regression failed before the fix. Bodyless deletion
  now succeeds, removes only its target, and clears deferred cleanup without
  restoring consent or subscribing automatically. All 58 focused tests passed.
- Actual **Remove Phone independent** returned 200 and removed its record while
  Desktop stayed enabled. Phone foreground did not register it again; explicit
  enable succeeded.
- Local Disable unsubscribed before a simulated cleanup PATCH 503. Restoring
  connectivity and foregrounding issued a successful DELETE, removed the server
  target, cleared the pending cleanup, and preserved opt-out.
- Permission revocation, missing subscription, key mismatch and remote removal
  stayed disabled. A later cross-tab disable defeated a delayed enable; the
  browser was unsubscribed and the server target was disabled or absent.
- Mobile **Remove Mobile** removed the current device, preserved opt-out and
  produced no horizontal page overflow. Desktop and mobile screenshots were
  opened and visually inspected: `qa-fix-desktop.png`, `qa-fix-mobile.png`.
- The bundled worker displayed all six fixed categories plus four malformed
  fallbacks, ignored secret canaries and fetched no protected run content.
  Notification icon/badge use `/icons/icon-192.png`; its HTTP response was 200,
  `image/png`, 19,060 bytes. Safe click/navigation checks passed.
- F1 created issue `issue-1` / session `session-1`, observed question and review
  changes, approved the fixture gate, and recovered a fixture shell failure.
  Nine expected per-device alerts were recorded: two question, four review,
  two completion and one failure. Initial enablement and ordinary saves did not
  replay attention; disabled Phone did not receive final completion.
- Edge-worker build/typecheck, Biome and diff checks passed. Historical WP-001,
  WP-002 and WP-003 dispositions remain fixed; their implementation is untouched.

Receipts are `qa-fix-browser-results.json`, `qa-fix-worker-results.json` and
`qa-fix-f1-results.json`, with drivers and logs alongside them. The browser driver
was corrected after its old assertion assumed a disabled record must remain;
successful cleanup can now remove it. The final run passed all eight cases.
The process restart stopped the isolated fixture after its evidence was saved.

## Unresolved required validation

The following records the state at this drive. The later user-authorized
[authenticated HTTPS follow-up](../../../docs/WEB_PUSH_HTTPS_QA.md) supplies the
protected browser/API checks; its native-device and production-Tailscale limits
remain explicit.

WP-QA-001, WP-QA-002 and gate-generated `qa-8db530f67f19c085` are corrected and
their affected failed criteria were retested. WP-QA-003 remains open, not rejected
or waived. Three deployed-device criteria still require reassessment and execution:
`push-device-real-receipt`, `push-device-protected-origin`, `push-device-reconnect`.

A later read-only check found a Tailscale HTTPS route to a separate prototype on
loopback 3557. Its `/api/push` returned 404, so this does not establish deployment
of the tested revision. No proxy configuration or prototype process was changed.
Provide the intended protected HTTPS deployment of this revision and authorized
target devices. Then execute registration, test, disable, notification navigation
and loss-of-access checks through that origin, and record timestamped foreground,
background, reconnect/re-enable observations on the agreed device/browser matrix.
Headless adapters and recorded sends cannot satisfy native receipt criteria.

Physical-device/background delivery, Brave iOS behavior, the accepted exception
for two existing dependency advisories, and the tracker snapshot discrepancy
remain limitations. No human approval, merge, PR readiness or tracker lifecycle
mutation occurred.
