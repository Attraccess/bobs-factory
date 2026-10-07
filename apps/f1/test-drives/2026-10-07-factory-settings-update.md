# Factory Settings app update

Date: 2026-10-07

Revision: 56fbc82e plus the FACTORY-AUTH-002 fix in this commit.

Changed behavior: accept `#/settings` in bounded update snapshots, allowing explicit
app updates in Settings and on the login screen after signing out from Settings.
F1 applies because this changes the authenticated dashboard update workflow.

## Scenario and evidence

A fresh embedded EdgeWorker used a temporary repository and Cyrus home, with
`F1_AGENT_MODE=mock` and injected `f1AgentHandlers("mock")`. No native agent or
provider API was used. The separate fixture listeners were localhost ports 47778
and 47779. A fresh headless `agent-browser` session
`fix79-settings-update-20261007` was driven through Playwright/CDP with a Chromium
virtual authenticator. Registration and authentication used real WebAuthn
ceremonies; no physical device is claimed.

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-09e877cd-6bbb-4ad8-9aec-85b6d59877e8/fix-settings-update/`.

Commands:

```sh
F1_AGENT_MODE=mock bun run <evidence>/fixture.mjs
agent-browser --headed false --session fix79-settings-update-20261007 open http://localhost:47779
node <evidence>/drive.mjs
agent-browser --session fix79-settings-update-20261007 close
```

The driver compiled two complete fixture shells with distinct build IDs, then
restarted only its private EdgeWorker. It waited for authoritative startup and
complete waiting service workers before invoking Update now. The final complete
run passed all six assertions in `results.json` / `drive.log`:

1. Authorized first-passkey registration reaches authenticated Settings.
2. Updating Settings activates the new shell, reloads, retains `#/settings`, and
   restores authenticated access (protected config returns 200).
3. Signing out retains `#/settings` and denies protected config (401).
4. Updating the signed-out shell activates another new build and retains both
   the Settings hash and private API protection.
5. Passkey login after updating returns to Settings with protected config 200.
6. Both update snapshots retain `#/settings`; the signed-out snapshot has no
   private drafts.

Screenshots were captured and individually inspected:
`settings-update-available.png`, `login-settings-update-available.png`, and
`updated-settings-mobile.png`. No rendering issue was observed.

## Targeted checks

The two new signed-in/signed-out snapshot regression cases failed before the
validator change with the reported draft-preservation error. After the fix:

```sh
pnpm --filter cyrus-edge-worker test:run test/FactoryPwa.test.ts test/FactoryWebClient.test.ts test/FactoryAuth.test.ts test/FactoryAccess.test.ts
pnpm --filter cyrus-edge-worker build
pnpm exec biome check packages/edge-worker/src/factory/web/restoration.ts packages/edge-worker/test/FactoryPwa.test.ts
```

All 63 tests, the package build, and Biome passed. The regression cases also
verify route restoration/consumption and that sign-out clears private drafts.

The fixture and its named browser session were stopped. Production services,
tunnels, tracker lifecycle, and active user sessions were untouched. Earlier
accepted tunnel and operator-reported phone evidence remains historical; this
focused drive does not repeat those checks. Live ticket synchronization remains
independently unverified. Prior nonblocking QA observations are unchanged.
