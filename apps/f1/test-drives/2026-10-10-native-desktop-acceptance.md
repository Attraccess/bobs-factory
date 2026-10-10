# Native desktop remote and continuity acceptance

**Result: PASS within the controlled scope below.** October 10, 2026;
Taskbot [#116](https://taskbot.apps.janjaap.de/p/bobs-factory/t/116),
[#121](https://taskbot.apps.janjaap.de/p/bobs-factory/t/121),
[#122](https://taskbot.apps.janjaap.de/p/bobs-factory/t/122),
[#124](https://taskbot.apps.janjaap.de/p/bobs-factory/t/124).
No production code changes or confirmed production defects in this drive.
The tickets remain open for the physical, platform and delivery gates below.

## Identity and applicability

This extends final draft [PR #85](https://github.com/jappyjan/bobs-factory/pull/85)
from isolated checkout `/tmp/bobs-factory-native-acceptance-116`, branch
`test/native-desktop-acceptance-116`, source
`e05c0dfa965d41faeb958ef44ca4bbfb4a070f50`. Production desktop/CLI/worker
sources are identical to frozen `ed7bcaf6feb0fb8f39d9e0255b2fea0bfffeb1f1`.
F1 applies to the new maintained behavior fixture: real workflow execution,
protected access/onboarding, native client isolation and persisted recovery.
The drive exercises those paths; it does not repeat the prior all-four matrix,
production review, signed 23-case integration or existing broad F1 fixtures.

- Actual target: **darwin-arm64**, macOS **26.5.2**, Electron **44.7.0**.
- Runtime: `1.0.0-nightly.20261010.7`, clean packaged `ed7` executable,
  SHA-256 `2a6ff0c44776fca160b0fd1ca1b583c6e85664375f33857c87d2bca034435d1a`,
  resource digest `4fc874433b46f5436701dc69cf06846a0203d82aa1a6d666e5c8d9a7653ebd60`.
- Retained CI run **38076783115**, macARM artifact **11679201099**, candidate
  `1c176a2d98cb18524a8f593eed73d335a747fa8b977ce4f4794e20a31084c791`.
  Unsigned DMG SHA-256
  `b295e4c9c1fea1db1db67e7250eaf5d8a726662707ab9cfea0609de66d3c8cfc`.
- The fixture uses the native Electron regression executable and imports the
  **read-only mounted app.asar** main/launcher. Its seven shell file hashes match
  `git show ed7:<path>`. This is a mounted shell behavior proof, not a trusted
  signed drag-to-Applications or Gatekeeper proof.
- Local and independent foreground workers execute the exact native binary.
  The second backend is a separate Node process running compiled production
  `FactoryServer`, `WorkflowRuntime` and `LocalOnboarding` at e05. Its frontend
  build `27373e598982a39ec881e40e` and protocol 1 match the native worker. It is
  reached over `https://localhost:19873` through a fixture TLS proxy, with its
  own home/auth store and worker ownership. It is an isolated host boundary on
  this Mac, not a second physical machine or a packaged remote EdgeWorker proof.

The [raw receipt](assets/2026-10-10-native-desktop-acceptance/native-acceptance.json)
retains runtime identity, mounted shell hashes, exact source/compiled/fixture
hashes and four separate Electron process phases. Receipt SHA-256:
`26dff571bf4bc12b9e3c4c6efdb44ccd8b56e37969dee16a6ba7046b02026a34`.

## Observed assertions

- The actual native worker PID **85442** retained a bounded shell job PID
  **85445** and descendant **85446** across window close/reopen and actual
  **Quit desktop UI**, followed by a fresh Electron process. Reattachment kept
  the same PID and ownership nonce; the job completed exactly once after an
  explicit fixture release. No paid role/title/provider process executed.
- A previously accepted mock preparation/session checkpoint, frozen definitions,
  completed outputs/history, retained draft, assistance question/batch and human
  review gate remained equal through client changes. The authenticated answer
  API accepted `Blue` with the saved batch context and completed the assistance
  workflow. The separate human review remained waiting and unapproved.
- Explicit native menu Stop ended only the desktop-owned worker. A deliberate
  subsequent local launch used new PID **85817**, retaining the same auth,
  human-review gate, accepted definitions and completed receipts without replay.
  The mock preparation receipt remained exactly one; this is preserved synthetic
  session metadata, not a real Codex/provider continuation claim. The real Git
  worktree and its uncommitted `retained.txt` survived.
- A separate native foreground worker PID **85927** was attached locally without
  duplication. Desktop Stop rejected its independent ownership; close/reopen and
  UI Quit kept it alive until its fixture owner stopped it.
- Remote virtual CTAP2 enrollment/login/logout ran in the actual secure-origin
  Electron session. Its Secure/HttpOnly session was isolated from the local
  origin partition. Transplanting the local session into the remote partition
  returned **401**, while restoring the remote session restored protected access.
  Raw anonymous update read/write returned **401**; a forged origin returned
  **403**. No auth/session token or private key is exported in the receipt.
- Remote Stop rejected ownership and left both independent backend and local
  native job alive. Remote close/reopen and UI Quit/relaunch retained its native
  session and saved setup. The dashboard had neither `require` nor the launcher
  bridge; insecure launcher origins and cross-origin navigation were rejected.
- A stale build header on a settings write returned **409 / FACTORY_VERSION_MISMATCH**
  with unchanged settings. Controlled CDP version responses independently changed
  protocol and build; both displayed useful update guidance and paused actions.
  Neither connected host's update settings changed. Removing the transport fault
  restored the ordinary UI; the fixture never installs an update.
- Guided onboarding rejected a missing repository without saving config, accepted
  a real temporary Git checkout and a fake installed Codex prerequisite, rejected
  insufficient synthetic GitHub readiness access without saving credentials, then
  saved the valid synthetic account and displayed
  [You’re ready to build](assets/2026-10-10-native-desktop-acceptance/onboarding.png).
  Production onboarding validation/persistence and the protected UI/API are real;
  GitHub responses and the repository-apply callback are controlled fixtures.
- A failed proxy API transport displayed connection-loss guidance while both
  workers remained alive. Reconnecting retained the same remote session and
  settings. No offline mutation was queued or applied.

## Reproduction and checks

Retrieve the exact macARM artifact from run 38076783115, verify its inventory,
extract the runtime and mount the DMG read-only. Build this isolated checkout
to supply the production modules used by the controlled backend:

```sh
pnpm install --frozen-lockfile
pnpm --filter 'bobs-factory...' build
node apps/desktop/test/run-native-acceptance.mjs \
  /tmp/native-acceptance-ed7-artifact/runtime/bobs-factory-1.0.0-nightly.20261010.7-darwin-arm64 \
  "/tmp/native-acceptance-ed7-mount/Bob's Factory.app" \
  /tmp/bobs-factory-desktop-121/apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron
node --test apps/desktop/test/contracts.test.mjs scripts/tests/desktop-runtime.test.mjs
pnpm exec biome check apps/desktop/test/acceptance-fixture.mjs \
  apps/desktop/test/native-acceptance.mjs apps/desktop/test/run-native-acceptance.mjs
git diff --check
```

The native drive and two relevant existing boundary tests passed. The controller
uses an allowlisted temporary environment/HOME/profile, refuses production source
drift, verifies executable and mounted shell hashes and bounds each Electron phase.
Test TLS trust is restricted to the exact ephemeral fixture certificate and origin;
no system trust, release-signing key or native credential store is altered.

Final temporary state/logs remain at
`/private/var/folders/_r/fld8l71j7ts635hlb5vtgnb80000gn/T/factory-native-acceptance-WZJneR`.
They include private **synthetic** test auth/TLS material and are not uploaded.
Cleanup confirmed all listed native workers/job descendants exited; the fixture
stopped its own separate backend and supervisors. No production service changed.

Preparatory fixture failures were retained separately and are not passing product
evidence. One initial packaged-app invocation ignored the test entry point and
opened the default launcher profile; it was stopped before any backend connection
or auth ceremony. The corrected command supplies a temporary profile before
startup and uses Electron's test executable. Other development corrections fixed
fixture ports, certificate matching and assertion shapes; no production fix was needed.

## Remaining gates and ownership

- Physical Touch ID/security keys, genuine separately prepared provider credentials
  and native provider continuation remain unproved. Software CTAP2, a fake installed
  command and synthetic checkpoint IDs cannot close those gates.
- Actual second-machine networking/pairing, remote workflow launch/provider operation
  and Linux native remote/mismatch/onboarding coverage remain separate acceptance.
  Existing #84 multi-instance and #41 PWA work are untouched; no duplicate project.
- Login/logout/reboot/lingering, PM2/manual/Nix handoff on disposable hosts, minimum
  macOS/glibc/CPU and trusted package install/upgrade/remove remain operator/native
  platform gates. This modern Mac does not establish the proposed minimum versions.
- Whole-Electron shell updates belong to the separate shell-update owner on
  `feat/desktop-shell-update-116`; this test branch never edits its production files
  and does not claim whole-app replacement. Runtime-only signed delivery's prior
  23-case report remains unchanged and was not rerun.
- Genuine publisher trust, protected signing/notarization, catalog activation,
  release eligibility/publication and merge remain separately gated. GitGuardian
  synthetic incidents **38083768** and **38084076** still require scoped operator
  review; no security bypass or historical evidence rewrite occurred.
