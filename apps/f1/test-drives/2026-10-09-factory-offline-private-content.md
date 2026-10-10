# Factory offline private-content regression drive

Date: 2026-10-09. Taskbot #40, draft PR [#71](https://github.com/JappyJan/bobs-factory/pull/71).

## Applicability and fixture

F1 applies to this client authentication change. This scoped drive exercises
actual built FactoryServer, WorkflowRuntime and browser authentication paths.
Issue routing and coding-agent execution are unchanged and were not exercised.
The isolated runtime has deterministic empty handlers; `F1_AGENT_MODE=mock`
was set. No live agent CLI/API or production service was used.

A fresh temporary Factory home and local HTTPS proxy preserve Host and Origin.
Dashboard: `https://qa40.localhost:47840`; internal listener: 47841;
fixture control/provider listener: 47842. A fresh explicitly headless
agent-browser session `qa40-offline-fix-20261009` used Chromium and a virtual
resident CTAP2 authenticator with user verification. Enrollment goes through
the real UI and server WebAuthn verification. No authenticated cookie was injected.
The web build was `cf89871ae880af7e15ad7ff1`.

## Expected behavior and results

- Operator-authorized browser enrollment opens authenticated Settings > Access.
- At 390×844, going offline removes private key names/origins and all Settings
  management controls. Only the public sign-in screen remains; passkey actions
  are disabled. An attempted private read fails with network unavailable.
- Blocking the access-status endpoint while `navigator.onLine` remains true
  also clears private Settings and disables passkey actions.
- Returning online restores Settings only after a valid server-session check.
  Retry connection also restores a still-valid session after the blocked endpoint
  is released. No new passkey ceremony is needed for that valid session.
- Expiring the server session during disconnection keeps private content hidden
  after reconnecting. Private API requests return 401; sign-in becomes available.
- All assertions passed. Mobile setup, authenticated, offline, failed-check,
  reconnected and expired screenshots were captured and visually inspected.
  Offline and failed-check screens have readable connection feedback and no
  horizontal overflow or private dashboard content.

## Other checks

`pnpm --filter bobs-factory-edge-worker exec vitest run
 test/FactoryWebClient.test.ts test/FactoryPwa.test.ts
 test/FactoryAuth.test.ts test/FactoryAccess.test.ts`: 75 tests passed.
These include cache clearing after network/502 failures, rejecting late private
responses, verified credential-management refresh, and protected API behavior.
Package build, package typecheck, changed-file Biome and `git diff --check` passed.

## Revision and evidence

Tested the fix atop `eabe7a3e4fa71b8254fde32f63b742c5225a33a9` before committing;
the exact tested source files are bound by SHA-256 below. The external
`revision.json` binds the committed delivery to the same source and web build.

| Tested source | SHA-256 |
| --- | --- |
| `packages/edge-worker/src/factory/web/auth-state.ts` | `1943297a41332ad64602d0d774350b4939de369d0e16ddf3962dece8d8161761` |
| `packages/edge-worker/src/factory/web/auth.tsx` | `041f6e2101f430e327fdc8cd364c677f26471393f62f1d28fc2277263c3c48b3` |
| `packages/edge-worker/src/factory/web/pwa.ts` | `1d56d049a71c7507d9a31890bae9941472df5cb909a3089d7f978492ea777eca` |

Scripts, results, logs and inspected PNGs are in
`/Users/jappy/.bobs-factory/factory/evidence/manual-58cb7337-4661-439e-a18e-6a7f063c4cae/qa40-offline-fix/`.
The named browser was closed and temporary fixture stopped. Historical failed
QA receipts were preserved. Physical Safari, native biometrics, production
zrok2 forwarding and live OAuth were not retested. No host trust store, tunnel,
production service or integration configuration changed.
