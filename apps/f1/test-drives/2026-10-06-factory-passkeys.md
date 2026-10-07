# Factory passkey access — 2026-10-06

Ticket: Taskbot #79. Base revision: `e5cd5b74f98bbadabf6939514e604a4b92833f3e`.
This drive exercises the uncommitted implementation, including the later human
decision to require authentication on localhost as well as the public address.

## Applicability and scope

F1 validation applies because dashboard authentication changes product behavior.
The selected scenario exercises the actual built EdgeWorker, FactoryServer,
LinearEventTransport, and browser UI in an isolated repository and home directory.
The scenario does not launch an AI coding session: runner selection and issue
processing are unchanged. No production worker, service, tunnel, or configuration
was changed.

Expected behavior:

- Dashboard reads, actions, media, and streams require a session on every address.
- First enrollment requires a short-lived authorization from the machine owner.
- Registration and login use real WebAuthn verification with user verification.
- Sign-out, expiry, and recovery revoke access; reconnect rechecks authorization.
- Credentials and valid sessions survive reconstruction of the dashboard listener.
- Independently verified provider webhooks do not grant dashboard access.
- Offline navigation cannot expose cached private dashboard content.

## Fixture

- Node 24.21, pnpm 10.33.1, Chromium 154 with a CDP virtual CTAP2 authenticator.
- Temporary Git repository and Cyrus home; dashboard `localhost:46157`, provider
  listener `127.0.0.1:46156`.
- A real `EdgeWorker` in CLI mode and a real direct-signature
  `LinearEventTransport` registered on its separate shared application server.
- Browser session `factory-passkeys-79`; resident credentials and user verification
  enabled. Virtual authenticators generate actual assertions; verification is not
  mocked.
- Final browser asset build: `a02cfacfce0a344f166b1547`.
- Fixture-only control routes on the provider listener reconstruct FactoryServer
  with its existing auth files and force stored sessions to expire. These routes
  are not product code.

Process restarts interrupted verification twice. Completed logs and screenshots
were retained. The isolated worker was restarted with its original temporary home.
The browser's replacement virtual authenticator required a fresh operator grant;
this was test-device replacement, not a product recovery operation.

## Results

| Scenario | Observed result |
| --- | --- |
| Empty auth store | First-passkey setup screen, with an operator-code field; unauthenticated APIs return 401. |
| Operator enrollment | Actual browser registration succeeds and opens the dashboard. |
| Multiple passkeys | Two credentials were registered, listed, and one removed through the UI during the initial drive. The remaining credential could sign in. |
| Local browser | Authentication is required. The IP-address shell redirects to localhost because Chromium rejects an IP address as a WebAuthn RP ID. |
| Sign-out | Explicit discard confirmation, login screen, and dashboard API returns 401. |
| Login | The final virtual device signs in with a real assertion; status reports authenticated. |
| Listener reconstruction | Reopening the same localhost origin remains authenticated using the durable session. |
| Browser offline | Dashboard unmounts and shows the offline sign-in screen. Going online revalidates the still-valid session before restoring the dashboard. |
| Forced server expiry | Dashboard API returns 401 immediately. The SSE reconnect receives 401 and replaces the dashboard with the expired-session login screen after its reconnect delay. |
| Signed Linear webhook | Correct HMAC signature returns 200 without a dashboard cookie. |
| Invalid provider delivery | Missing or incorrect signatures return 401. |
| Provider/dashboard isolation | Unauthenticated dashboard reads return 401; posting the provider webhook path to the dashboard returns 401. |

The mobile screenshots were inspected. The final offline and expired screens show
only authentication controls, without private dashboard content.

## Automated and build checks

- `pnpm build`: passed on the final files.
- `pnpm typecheck`: passed on the final implementation.
- Six targeted Vitest suites (`FactoryAuth`, `FactoryAccess`, `FactoryServer`,
  `FactoryWebClient`, `FactoryPwa`, `ReviewFiles`): **73 passed**. Real signed
  WebAuthn fixtures cover challenge/signature/origin/UV failures, replay, browser
  binding, zero-counter authenticators, durable sessions, corruption, recovery,
  credential removal, and last-key safeguards. HTTP tests cover spoofed headers,
  missing Origin, protected data/media, cookie flags, and live SSE closure.
- An earlier run timed out in the existing Git-backed file-review test under heavy
  host load. The final six-suite run with one worker and a 90-second timeout passed
  all 73 tests; it completed in 46.77 seconds.
- Linear transport tests: **36 passed**. Existing SelfAuthCommand callback tests:
  **12 passed**.
- Installed CLI smoke check in a separate temporary home: enrollment succeeds,
  authorization file has mode `0600`, recovery without confirmation fails, and
  confirmed recovery writes the marker. The command does not start a worker.
- Biome: all 26 changed TypeScript/TSX/JSON files passed. `git diff --check` passed.
- `pnpm install --frozen-lockfile`: passed after pruning unrelated lockfile changes.

## Initial security policy blocker (resolved on resumed implementation)

`pnpm audit --json` reports two high-severity warnings already present in the base
dependency graph: `node-forge` 1.4.0
([GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv)) and
`braces` 3.0.3
([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)).
The audit response reports no patched release for either package. These packages
were not introduced by the WebAuthn libraries. Compatible natural resolutions
updated `proxy-addr` and `source-map-js`, removing their warnings without overrides.

The repository's Dependency Security Policy requires zero warnings after dependency
changes. The human subsequently authorized expanding this task to fix these two warnings.
The resumed implementation removes both vulnerable packages rather than suppressing
the warnings. The original audit evidence is preserved.

## Evidence and remaining QA

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-09e877cd-6bbb-4ad8-9aec-85b6d59877e8`.

- `passkey-first-setup.png`: initial empty-store setup screen.
- `passkey-two-credentials.png`: initial browser drive with two enrolled devices.
- `passkey-final-mobile-dashboard.png`: final authenticated view at 390 × 844.
- `passkey-final-offline.png`: final browser with offline mode enabled.
- `passkey-final-expired.png`: final expired-session login screen.
- Sanitized verification logs and audit results are retained beside the images.

Physical iPhone/Safari enrollment, cross-device QR flows, and actual zrok2 header
forwarding remain QA/rollout checks. This drive used localhost and did not alter or
test production tunnels. HTTPS-origin verification and secure cookie flags have
automated coverage, but a physical browser on the public origin is still needed.
OAuth callback preservation is covered by the existing temporary-listener tests;
no live OAuth authorization or provider account mutation was performed.

PR creation, changelog links, review, QA, and production rollout belong to subsequent
Factory roles. No PR was created or published by this implementation step.

Cleanup completed: the fixture worker stopped gracefully and saved its state;
the virtual-authenticator process and the task's browser session were closed.
The temporary fixture files and recorded evidence remain available for inspection.
The provider log's signature-verification error came from the deliberate invalid
signature case, which correctly returned 401.

## Dependency-security follow-up

The resumed implementation replaces the owning `node-forge` dependency with
`@peculiar/x509` 2.1.0, using Node's native WebCrypto for key generation and signing.
CA creation now finishes in `start()` before either proxy listener opens.
Existing CA certificates and legacy PKCS#1 private keys remain in place; keys
are converted to PKCS#8 only in memory for WebCrypto import.

Neither the latest Forge, Nodemon nor Tailwind CLI releases provided a patched
dependency graph at the time of the change. The unused CLI Nodemon dependency was
removed. Factory's one-shot stylesheet build now uses `@tailwindcss/node` and
`@tailwindcss/oxide` directly, avoiding the CLI's Parcel watcher and its vulnerable
`braces` dependency. Generated CSS is byte-for-byte identical (68,395 bytes).
The now-unused brace-expansion overrides were removed from the root package and
workspace configuration. No audit warning is ignored and no new override is added.

Final dependency graph: `pnpm install --frozen-lockfile` passed;
`pnpm audit --json` reports zero advisories. Follow-up validation on the final implementation:

- `pnpm build` and `pnpm typecheck` passed; the affected EdgeWorker package was
  rebuilt and typechecked again after adding the required reflection polyfill.
- Seven targeted suites: **90 passed**, including real TLS verification against
  the reused CA and rejection of a mismatched server hostname. The legacy-key test
  imports a PKCS#1 CA key without rewriting the trusted certificate.
- Linear transport: **36 passed**. OAuth callback tests: **12 passed**.
- Biome: all **31** changed TypeScript/TSX/JavaScript/JSON files passed.
  Build-script syntax and `git diff --check` passed.
- Isolated built EdgeWorker (Node 26.10.0) with sandbox enabled: real CONNECT/TLS
  handshake succeeds, native signature and hostname verification succeed, and
  unauthenticated dashboard reads still return 401. Signed provider deliveries
  return 200; invalid and unsigned deliveries return 401.
- Full worker shutdown/restart in the same temporary home preserved the exact CA
  certificate and authenticated browser session; another trusted TLS handshake passed.
- Chromium virtual-authenticator browser drive at 390 × 844: first setup,
  enrollment, authenticated dashboard, logout, login, offline protection and
  expired-session feedback all passed. Screenshot inspection confirmed the
  mobile screens render correctly and offline/expiry screens hide private data.
  Browser error collection was empty.

New evidence uses the `passkey-security-` prefix in the same evidence directory;
previous evidence remains untouched. Mobile screenshots include `setup`,
`dashboard`, `offline` and `expired`. The dependency-security blocker is resolved;
physical iPhone/Safari and actual zrok2 forwarding remain for subsequent QA.

The follow-up fixtures were stopped cleanly; the worker saved its state and closed
both provider and egress listeners. The TLS probe closes its client immediately
after native certificate verification. The server logged a caught `socket hang up`
on that deliberate close; no uncaught exception or verification failure occurred.
