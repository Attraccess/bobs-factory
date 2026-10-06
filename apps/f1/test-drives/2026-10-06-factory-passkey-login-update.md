# Factory passkey login after a cached-shell deployment

Date: 2026-10-06. Finding: `FACTORY-AUTH-001`, Taskbot #79, PR #27.
Tested revision: `170ff39a1f674f4391b6a503b7152f88c9bf1212` plus the
`auth.tsx` and `pwa-ui.tsx` working changes committed with this report.

Authentication/PWA workflow changes require F1 validation. This focused drive
uses the built EdgeWorker and FactoryServer with a fresh temporary repository,
Cyrus home, and loopback listeners on 46257 (dashboard) and 46256 (provider).
No AI session is needed: issue processing and runner behavior are unchanged.
Production services, state, and tunnels were untouched.

## Scenario and assertions

A signed-out browser retains an old service-worker shell after a deployment.
It must offer an explicit update before authentication, keep private APIs
protected, load the completed new shell, and allow passkey login afterward.

Node 24 and Chromium were used with the dedicated agent-browser session
`factory-auth-update-fix` and a CDP CTAP2 virtual authenticator supporting
resident credentials and user verification. WebAuthn verification was real.
The browser viewport was 390 × 844; this is mobile emulation, not Safari/iPhone.

1. Started `/tmp/factory-auth-update-fix/server.mjs` with a fresh temporary home.
   Enrolled a fixture passkey using locally generated operator authorization.
   The dashboard opened; then signed out with discard confirmation accepted.
2. Initial build `bfe32d28fd7d3bc55f4b467e` was cached and controlled by its
   service worker. Built a distinct deployment using a temporary copy of the
   web builder with a fixture-only source comment; the builder includes its
   source in build identity. No product source changed for this second build.
3. Reconstructed only the isolated FactoryServer via its fixture control route.
   The new server build was `7547b5206089c35cb9e7317f`. Reload retained the old
   `app.32e86008336fb7e946cc9fc9.js` shell, reproducing the stale deployment state.
4. The unauthenticated screen showed “Factory updated”, **Update now**, and
   disabled passkey login. `/api/config` returned **401**. The existing version,
   shell download, verification, activation, and reload flow required no login.
5. Clicked **Update now**. The page loaded
   `app.2cd3be14724bf718a74fc35e.js`, removed the update notice, and enabled login.
   Clicked **Sign in with passkey**. The actual assertion verified successfully;
   auth status reported authenticated, `/api/config` returned **200**, and the
   dashboard rendered.

## Checks and evidence

- `pnpm build`: passed.
- `pnpm typecheck`: passed.
- `pnpm --filter cyrus-edge-worker test:run test/FactoryPwa.test.ts test/FactoryAccess.test.ts test/FactoryWebClient.test.ts --maxWorkers=1 --testTimeout=90000`: **42 passed**.
- Changed-file Biome and `git diff --check`: passed.
- Inspected screenshots in the run evidence directory:
  `fix-stale-shell-update.png` and `fix-updated-shell-signed-in.png`.
  The login screenshot shows the update control without private dashboard data.

The fix also maps an auth endpoint's `FACTORY_VERSION_MISMATCH` rejection into
the same update state, preserving the existing server version guard.

The fixture worker, virtual authenticator, and named browser were stopped.
The temporary builder was removed and the worktree build pointer restored to the
normal build. Fixture logs/state remain in `/tmp/factory-auth-update-fix`.
Physical iPhone/Safari and actual zrok2 forwarding remain the previously recorded
QA/rollout limitations; this targeted fix does not establish that coverage.
