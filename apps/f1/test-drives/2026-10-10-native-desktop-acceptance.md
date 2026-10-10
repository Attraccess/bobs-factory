# Native desktop remote and continuity acceptance

**Result: PASS within the controlled scope below.** October 10, 2026;
Taskbot [#116](https://taskbot.apps.janjaap.de/p/bobs-factory/t/116),
[#121](https://taskbot.apps.janjaap.de/p/bobs-factory/t/121),
[#122](https://taskbot.apps.janjaap.de/p/bobs-factory/t/122),
[#124](https://taskbot.apps.janjaap.de/p/bobs-factory/t/124).
Test-only draft stack: [PR #88](https://github.com/jappyjan/bobs-factory/pull/88).
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

This receipt is historical evidence from the original controller. Independent
review at `a0d3300dcc9f54f77a2857e4a322a9cdd0332dbf` found that its
`passed:true` was written before cleanup and only the backend was awaited.
It therefore does **not** prove cleanup completion. Its bytes and original
fixture hashes remain unchanged; the corrected controller evidence below is
a separate run, not a relabeling of this receipt. The historical raw receipt hash
above predates repository JSON formatting; its unchanged committed file SHA-256
is `addf36b67a489de427cca5ba6ee1c04030e75d3ec24fc1e8c1b0738bba61a1f5`.

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

The native drive and two relevant existing boundary tests passed. Required commit
hooks also passed staged Biome, full workspace build and full workspace typecheck. The controller
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


## Independent P2 cleanup correction

The finding at `a0d3300dcc9f54f77a2857e4a322a9cdd0332dbf` is fixed in the
maintained test controller. Every direct fixture child now has its own POSIX
process group and a close-event promise. The ledger also records detached native
workers/supervisors from the three explicit fixture homes, binding ownership to
home directory identity, exact lock text/nonce, kernel start stamp, canonical
executable identity and its frozen binary hash. It records group members while
leaders are alive, so a leader exiting first does not drop its descendants.

Cleanup sends TERM, waits a bounded grace period, escalates remaining owned
groups to KILL, waits for every spawned child and verifies no live group members
or fixture worker/supervisor locks remain. Zombies are terminated processes,
not running work. A stale/reused PID, overwritten lock or replaced home fails
closed: no guessed signals or deletion. An unrelated foreground process is
outside the ledger. Controller TERM/INT and exceptions produce a failed receipt;
PASS is finalized only after cleanup and HTTPS proxy closure succeed. Optional
`F1_NATIVE_ACCEPTANCE_RECEIPT` preserves the requested receipt outside the fixture
HOME. No helper is imported from the separate, unmerged PR87.

**Fresh native/F1 result: PASS**, including all four actual Electron phases and
cleanup, using the same exact ed7 binary/read-only mounted app and the original
controlled scope above. The final run executed the modified test bytes on parent
`a0d3300dcc9f54f77a2857e4a322a9cdd0332dbf`; file hashes bind the corrected working tree, rather than
claiming the parent commit contains these changes.

- [Fresh receipt](assets/2026-10-10-native-desktop-acceptance/corrected-native-acceptance.json):
  SHA-256 `9bfc07873dbbca29eeac324f6e04629f2d549511b03e03a8dc84644def15332a`.
- Corrected controller SHA-256: `1d63e3d6849be96d40e6f8541489a987450ea0d738661e78dd07af368c7db427`.
- Cleanup helper SHA-256: `0d5893e4a95d3a58ef800c720ad470857730bd4bc0051057d8c4db1ae46f7d97`.
- [Cleanup/check bindings](assets/2026-10-10-native-desktop-acceptance/cleanup-validation.json):
  9 owned groups drained, 6 direct children closed,
  4 recorded locks verified removed, no remaining groups or failures.
- [Focused test output](assets/2026-10-10-native-desktop-acceptance/cleanup-regressions.txt):
  eight process/receipt regressions plus two existing desktop boundary tests,
  **10/10 PASS**. These execute actual TERM-ignoring children, an exited parent
  with a stubborn descendant, controller SIGTERM/nonzero exit, failed lock
  removal, a cleanup exception/nonzero exit, stale PID identity, lock overwrite,
  replacement HOME and an unrelated surviving foreground process. No source-text
  assertions substitute for process behavior.

The first corrected-drive attempts accurately returned cleanup FAIL while native
workflow assertions passed: [canonical launcher alias validation failure](assets/2026-10-10-native-desktop-acceptance/cleanup-development-alias-fail.json)
and [mutable argv identity validation failure](assets/2026-10-10-native-desktop-acceptance/cleanup-development-argv-fail.json).
The final ledger resolves the launcher symlink for executable validation and uses
the kernel start stamp for process identity, which survives exec/argv changes.
These are fixture-development failures, not production defects or PASS evidence.
Their isolated state is retained privately; the final native fixture is
`/private/var/folders/_r/fld8l71j7ts635hlb5vtgnb80000gn/T/factory-native-acceptance-ql58uH`.

Recheck the changed path with:

```sh
node --test apps/desktop/test/acceptance-cleanup.test.mjs \
  apps/desktop/test/contracts.test.mjs scripts/tests/desktop-runtime.test.mjs
F1_NATIVE_ACCEPTANCE_RECEIPT=/tmp/pr88-final-native-acceptance.json \
  node apps/desktop/test/run-native-acceptance.mjs \
  /tmp/native-acceptance-ed7-artifact/runtime/bobs-factory-1.0.0-nightly.20261010.7-darwin-arm64 \
  "/tmp/native-acceptance-ed7-mount/Bob's Factory.app" \
  /tmp/bobs-factory-desktop-121/apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron
```

No build/matrix/signed23 repetition or new production acceptance claim is made.
All physical/provider/second-machine/Linux/minimum-OS/reboot/logout/signing/publication
and whole-shell gates above remain open. GitGuardian incidents 38083768 and
38084076 retain their operator-review gate; no bypass or history rewrite.

Required hooks for the correction passed staged Biome, full workspace build and
full workspace typecheck. Syntax/JSON/hash checks and `git diff --check` passed.
The raw new receipt was formatted as repository JSON without changing its values;
`cleanup-validation.json` retains both raw and committed receipt SHA-256 values.

## Follow-up: reject stale receipt reuse

The round-2 review found that `acceptanceRun` could start work while an old PASS
receipt still occupied the requested path. A new run now atomically claims a
fresh path with `passed: false` and `finalization: "pending"` before invoking
work. Existing paths are rejected without modification. After cleanup, final
JSON is written to a same-directory temporary file and atomically renamed over
only the path reserved by this run. A partial write, cleanup error or failed
rename therefore leaves the current receipt nonpassing; successful finalization
marks it complete.

The focused receipt-lifecycle evidence is separate from the native drive:
[receipt validation](assets/2026-10-10-native-desktop-acceptance/receipt-validation.json)
binds the current helper and regression-test hashes, and
[test output](assets/2026-10-10-native-desktop-acceptance/receipt-regressions.txt)
records 13/13 checks passing. It covers byte-preserving rejection of an existing
PASS before work, an injected partial final write, cleanup failure with final
rename failure, successful atomic publication, controller SIGTERM with a
pending receipt visible during work, and the existing process/desktop boundary
checks. The prior native receipt remains unchanged and bound to the helper used
for that earlier run; this follow-up does not claim a new native execution.

No full native rerun was needed for this receipt-only change. Physical passkeys
or provider credentials, another physical machine, Linux/new minimum OS,
reboot/logout, lingering services, public signing/install, licensing/release,
and whole-app update remain outside the evidence. GitGuardian incidents
38083768 and 38084076 remain operator gates.
