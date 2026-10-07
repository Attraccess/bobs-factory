# Factory passkey sign-in and Settings feedback

Date: 2026-10-07. Taskbot #79, draft PR #27.
Tested revision: `f5df82383bd9e90404b2886711875d40ddf59206` plus the UI,
auth-state and regression-test changes committed with this report.

The human rejection requests login as the default and key management on a
proper settings page. This focused authentication/UI drive uses the built
EdgeWorker and FactoryServer, a fresh temporary repository and Cyrus home,
and loopback ports 46679 (dashboard) / 46678 (provider). `F1_AGENT_MODE=mock`
and injected `f1AgentHandlers('mock')` prevent provider-credit use. No agent
execution or unrelated issue workflow is needed for this UI change.

The dedicated agent-browser session `factory-human79-20261007` starts with
`--headed false`. Playwright connects only to that session's CDP endpoint.
Two CTAP2 virtual authenticators exercise real WebAuthn registration and
assertion verification. Chromium mobile emulation is not an iPhone/Safari test.
Production services, tunnels, integration configuration and active runs are
untouched.

## Assertions and results

All nine changed-behavior checks passed:

1. Empty stores show first-key setup, require operator authorization, and deny
   private API reads before login.
2. Real registration opens the dashboard without a global passkey panel.
3. Settings adds a named second key through its inline form, verifying an
   existing key before registering a distinct virtual authenticator.
4. Removal verifies the retained key, removes the companion, and refreshes the
   list. The last key cannot be removed.
5. Settings sign-out returns to login and denies private API reads. Setup is
   folded by default; the sign-in button remains visible.
6. The setup disclosure opens/closes. Even with an unused code in the folded
   form, normal sign-in performs authentication rather than registration.
7. Today has no key panel; Settings is a dedicated route with correct active
   navigation and survives direct reload.
8. Settings and login fit 390×844 in light/dark themes without horizontal
   overflow. Desktop Settings was also captured at 1280×900.
9. Regression coverage confirms a verified-session refresh preserves mounted
   management state and updates the deadline, while denied access still clears
   private queries and signed-out refreshes show the checking boundary.

During development the drive exposed management remounting after verification.
The fix refreshes already-authenticated access in the background only after a
successful ceremony; normal visibility/reconnect checks retain their boundary.
A separate fixture correction uses distinct authenticators, since registering
an already-enrolled authenticator is correctly rejected.

## Commands and evidence

- `pnpm --filter cyrus-edge-worker build`: passed.
- `pnpm --filter cyrus-edge-worker typecheck`: passed before the auth-state delta;
  full build/typecheck are also required by the commit hook.
- `pnpm --filter cyrus-edge-worker test:run test/FactoryAuth.test.ts test/FactoryAccess.test.ts test/FactoryPwa.test.ts test/FactoryWebClient.test.ts --maxWorkers=1`: 60 passed.
- Changed-file Biome checks and `git diff --check`: passed. CSS retains existing
  nonblocking specificity warnings.
- `F1_AGENT_MODE=mock node <evidence>/human-feedback/fixture.mjs`, then
  `agent-browser --headed false --session factory-human79-20261007 open http://localhost:46679`,
  then `F1_AGENT_MODE=mock node <evidence>/human-feedback/drive.mjs`: nine passing
  receipts in `results.json`.

Evidence root:
`/Users/jappy/.cyrus/factory/evidence/manual-09e877cd-6bbb-4ad8-9aec-85b6d59877e8/human-feedback/`.
The fixture and driver are retained there. Screenshots contain no setup codes,
cookies or credential secrets: `first-setup-mobile.png`, `login-mobile-light.png`,
`login-mobile-dark.png`, `settings-mobile-light.png`, `settings-mobile-dark.png`,
and `settings-desktop-light.png`. Representative images were opened for visual
inspection. Only the isolated fixture and dedicated browser are stopped afterward.

## Preserved findings and limitations

`FACTORY-AUTH-001`, `QA79-CONFIG-001` and `QA79-PUBLIC-001` keep their prior resolved
dispositions. Prior nonblocking observations `QA79-OBS-001` (connection wording
after reachable-server logout/revocation) and `QA79-OBS-002` (worker registration
timing) remain; this feedback change does not claim to fix them. The former was
also observed after key-session rotation and logout in this drive.

Historical physical iPhone and real-tunnel receipts are preserved, not rerun.
Physical outcomes remain operator-reported on an isolated public share; production
origin enrollment remains parent-owned rollout work. Live ticket synchronization
remains independently unverified. Runtime owns lifecycle mutations. PR #27
remains draft; this role neither approves, marks ready, merges nor deploys.
