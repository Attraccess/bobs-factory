# Protected HTTPS Web Push QA

Date: 2026-10-07. Tested runtime revision
`d3b5c920224e87305d31b78e988e7c7003cdf0b1`, Factory build
`e4779c9272ea8e2be6f2799b`, Chromium `154.0.8037.92`.
Draft PR: [#35](https://github.com/Attraccess/bobs-factory/pull/35).

This addresses the protected HTTPS browser/API evidence missing in WP-QA-003.
The user authorized the replacement QA environment at 12:53:05 UTC:
“use the zrok2 tunnel cli to access a local dev instance over https for QA runs”.
The existing production Tailscale deployment was not changed or validated.

## Environment and commands

The isolated EdgeWorker used `/tmp/qa69-https-20261007` and a fresh fixture
repository `/tmp/qa69-https-repo-20261007`. Its Factory listener stayed on
loopback `3603`; a fixture-only access gateway listened on loopback `3599`.
The gateway forwarded Host and Origin unchanged and allowed deliberate access
revocation for an already authenticated browser. Controls and mock F1 RPC stayed
on loopback `3602` and `3601`, outside the tunnel.

`zrok2` 2.0.3 shared only the gateway, with a generated Basic Auth password.
Unauthenticated requests were rejected by zrok before reaching Factory. The
temporary origin was `https://vzi20tfvizbv.zrok.apps.janjaap.de`; it was set as
`CYRUS_FACTORY_ORIGIN`. Server traces confirm the public Host and HTTPS Origin
reached Factory's actual guards. TLS validation was enabled. No credentials,
private VAPID keys or production data were included in evidence.

```sh
pnpm --filter cyrus-edge-worker build
# qa-https-tunnel.mjs generates/reads fixture-only credentials outside evidence:
node <evidence-directory>/qa-https-tunnel.mjs
F1_AGENT_MODE=mock node <evidence-directory>/qa-https-fixture.mjs
agent-browser --headed false --session qa69-https-20261007 open about:blank
node <evidence-directory>/qa-https-native.mjs
node <evidence-directory>/qa-https-browser.mjs
node <evidence-directory>/qa-https-navigation.mjs
```

Playwright used CDP only for that fresh headless agent-browser session. Agent
hooks were deterministic mocks; no live agent/provider-credit calls occurred.
The browser permission/subscription adapters and recording push sender were
explicit mocks. They did not intercept the HTTPS API requests in these flows.

## Timestamped results (UTC)

| Time | Check | Observation |
| --- | --- | --- |
| 13:01:06–13:01:09 | Native headless attempt | Secure context and active service worker; pregranted browser permission. Native subscription failed with `Registration failed - permission denied`. No real subscription or receipt claimed. |
| 13:02:49 | Unauthenticated access | Root, push status, run list, run and guide returned 401. Device-registration POST also returned 401. No Factory data was returned. |
| 13:02:49 | Proxy request guards | Authenticated foreign-Origin POST returned 403 `Invalid origin`; missing `X-Factory-Request` returned 403. |
| 13:02:54–13:02:55 | UI enable | Permission adapter was called from an active user interaction. Real HTTPS device-registration POST returned 200; no existing attention was replayed. |
| 13:02:55 | UI test | Real HTTPS test POST returned 200 and the recording sender received the minimal test payload. Acceptance text was exercised with a mocked sender, not observed at a provider. |
| 13:02:56–13:03:01 | Disable, reconnect, re-enable | HTTPS PATCH returned 200, browser adapter unsubscribed and server targeting stopped. A question transition while disabled sent nothing. Explicit re-enable replayed nothing; a subsequent fresh review reached the recorder. |
| 13:03:04 | Review notification destination | Synthetic click dispatched in the actual installed worker navigated the existing tab. A previously pending review was refetched as approved; approval/rejection controls were absent. |
| 13:03:05 | Existing-client loss of access | Gateway access was revoked. Authenticated run read and review write returned 403. Notification navigation showed the connection error and disabled feedback submission; loaded stale information was explicitly labeled. |
| 13:03:17 | Offline disable and recovery | Real browser offline mode preserved local opt-out and unsubscribed before failed cleanup. On reconnect, HTTPS DELETE returned 200, removed the server target and cleared pending cleanup without re-registering. Unsent launch text survived navigation and access recovery. |
| 13:04:35–13:04:36 | Question, run and review links | All three synthetic worker-click destinations navigated through the HTTPS origin and completed authoritative refresh. |

All nine browser-flow assertions and three destination checks passed. Server
traces contain 200 registration/test/PATCH/DELETE responses with the configured
public Host and HTTPS Origin. Browser page-error collection was empty.
The build passed. This follow-up changes documentation only, so no new agent
lifecycle F1 drive was required; prior scoped mocked F1 reports are retained.

## Evidence and limits

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-56a8faa8-c83d-4083-a81b-b98174357df8`.
Drivers and logs are alongside `qa-https-native-results.json`,
`qa-https-browser-results.json`, `qa-https-navigation-results.json` and
`qa-https-server-http.jsonl`. Inspected screenshots are `qa-https-enabled.png`,
`qa-https-review-ready.png` and `qa-https-access-denied.png`.
The earlier `qa-https-review.png` captures the checking state during refresh.

Synthetic worker click events exercised destination selection and same-tab
messaging. Chromium rejected their final `WindowClient.focus()` with
`InvalidAccessError: Not allowed to focus a window`; this harness did not provide
a trusted OS notification click. Native focus/open-window behavior, real provider
acceptance, foreground/background display, physical-device reconnect and the
macOS/iPhone/Android browser matrix remain unverified under the existing device
testing waiver. Mocked sends are not native receipts.

The authenticated tunnel establishes the authorized local HTTPS workflow and
proxy guard checks, not deployment-specific Tailscale ACL correctness. The
tunnel, fixture and fresh browser session were stopped after evidence capture.
The accepted exception for the existing node-forge/braces advisories and the
tracker snapshot/lifecycle synchronization discrepancy remain limitations.
No merge, PR readiness change or ticket lifecycle mutation was performed.
