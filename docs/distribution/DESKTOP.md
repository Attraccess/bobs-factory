# Desktop candidate preparation

The native shell reuses the Factory web UI and authenticated APIs. Its launcher
opens the local Factory or an explicit remote HTTPS origin. Local launch offers
the existing protected passkey/repository/provider onboarding, without installing
agents or moving their native credentials. Each dashboard origin has a separate
persistent Electron session. Factory web contents have sandboxing, context isolation,
no Node integration. Its minimal preload can only open the local app settings
window. The packaged launcher owns connection and shell-update actions;
sender/frame/URL are checked by the main process for every bridge request.
Cross-origin navigation is blocked, and external HTTP(S) links open in the browser.

Closing the dashboard hides its window on macOS and Linux. Quit desktop UI leaves
the detached worker running. Reopen reattaches to its ownership record and dashboard
port. **Factory → Stop local Factory** separately confirms graceful termination
and targets only the selected desktop-owned worker, verifying its nonce, executable,
home and process start identity. Independently managed services/remote hosts require
their own controls. No client action supplies update consent.

Four intended targets are macOS ARM64/x64 (macOS 13+ proposed baseline) and Linux
glibc ARM64/x64 (glibc 2.35+ proposed baseline). Minimum versions are proposals,
not native-tested compatibility claims. Windows/musl are excluded. Artifact names:

- `bobs-factory-desktop-VERSION-mac-ARCH.dmg`, with Bob's Factory.app and Applications link.
- `bobs-factory-desktop-VERSION-linux-ARCH.AppImage`.
- `bobs-factory-desktop-VERSION-linux-ARCH.deb`.

AppImage/user installation ownership differs from DEB/AUR/Homebrew/system packages.
System/external managers own their upgrades. DEB/AUR/system paths, Homebrew
Caskroom/Cellar links and non-writable/non-user-owned apps show an owner handoff.
A normal DMG app in Applications is eligible when the app is user-owned,
both app and parent are writable, and its complete bytes
match an authentic signed release.
An arbitrary writable executable or symlink is insufficient update authority.

## Complete app updates

**Factory → Desktop app updates** shows the local shell's exact version/commit,
channel, effective policy, pending candidate, result and recovery state. The shared
dashboard Updates page opens these local settings separately from the selected
backend's settings. Shell settings live in `<factoryHome>/desktop/updates/state.json`
and use the same `UpdateManager` policy, revisions, consent and candidate rules as
runtime updates. Stable defaults to Notify/manual Install; nightly defaults to
Automatic when idle. Both channel overrides persist, along with pause and exact pin.
Verify installed app enrolls only a byte-matching signed release. Without that
receipt the app checks/notifies but cannot activate. Missing production pins or
unpublished inventories remain visible verification failures, never unsigned fallback.

Install authorizes the displayed exact candidate at the displayed settings
revision. Cancel pauses queued activation. The supervisor rechecks policy and idle
state at its atomic stopping boundary. Once stopping/recovery begins, conflicting
settings changes are rejected until completion; Quit/window close is never consent.
An intentional older stable shell requires explicit Install even in automatic mode.
Polling/backoff/coalescing use the existing shared manager. Changing the shell
policy cannot change or activate any local/remote backend's policy.

The signed desktop inventory binds the installer, `updateArchive`, update metadata
and validation to channel/version/commit/target, candidate digest and tooling SHA.
Linux updates replace the exact signed AppImage bytes. macOS additionally delivers
a complete `.bobsapp.gz` recovery archive: a framed gzip inventory retaining file
bytes, modes and internal framework links, rejecting traversal/link ancestry and
special files. The DMG remains the drag/drop installer. `prepare-desktop-update.mjs`
verifies an already signed/notarized app, never signs it. Its explicit `--unsigned`
preparation produces metadata that the macOS updater refuses. Production staging
requires real codesign verification and Gatekeeper assessment after extraction.

Before replacement an external helper retained outside the app acquires the
existing per-home lifecycle guard/update fence and the authenticated local drain.
It admits no active work or descendant leases, captures the existing worker PID/
nonce and waits for the precise Electron UI process to exit. It does not stop,
start, replace or upgrade that worker. It replaces the whole app, retains previous
bytes, launches the new UI, and verifies a transaction-bound health receipt and
unchanged worker ownership. Failed candidates are suppressed and restore the
verified previous UI with its own health check. Config, checkpoints, worktrees,
native credentials and conversation stores are never copied or rewound. Interrupted
switches retain the journal, old app and fence for explicit recovery. Ambiguous
process ownership blocks recovery rather than signaling an unrelated process.

An older runtime lacking `desktop-app-maintenance-v1` must be updated separately
through its owner before shell activation with a live local worker. The backend
serves its own versioned dashboard; same-protocol shell/runtime versions may differ.
Unsupported protocol is refused with explicit owner guidance, while existing web
build checks pause stale writes. No connection or shell update updates remote hosts.

## Candidate preparation and validation

`desktop-build.yml` prepares unsigned four-target installers from frozen candidate
bytes, with a hash-verified matching runtime, exact source/version/target and
`desktop-build.json` inventory. Its pull-request preparation route executes only
for the same-repository desktop delivery branch; it freezes the exact PR head
for both source and tooling, never the synthetic merge. One candidate is shared
across all native jobs. This lets review obtain unsigned native evidence without
merging the product to register a dispatch workflow. Read-only permissions and
credential-free checkouts accompany builds with publication disabled; no signing
or publication secrets are supplied. It never signs, notarizes or publishes. Local build:

```sh
node scripts/build-desktop.mjs --candidate /private/candidate.json \
  --runtime /private/bobs-factory-VERSION-TARGET --output /private/desktop
```

The build copies the exact pinned Electron distribution's `LICENSE` and
`LICENSES.chromium.html` to `Resources/electron-licenses` on macOS and
`resources/electron-licenses` on Linux. Desktop update metadata binds their
version, sizes and SHA-256 digests to the candidate. Preparation inspects the
actual read-only mounted DMG, extracted AppImage and DEB, and the extracted
complete macOS recovery archive; missing or changed notice bytes fail the build.
`desktop-build.json.licenseValidation` retains candidate-bound installer hashes
and actual notice comparisons. These checks do not constitute source/relink or
release licensing acceptance. The frozen ed7/58 packages predate this correction;
their runtime notice files do not prove Electron/Chromium notice inclusion.
Runtime source/rebuild material and reviewed licensing receipts remain separate
release gates.
The [complete-shell validation report](../../apps/f1/test-drives/2026-10-10-desktop-shell-update.md)
preserves exact candidate hashes, actual native notice receipts and their limits.

Electron 44 Touch ID requires an approved code-signing keychain access group and
matching entitlement. `BOBS_FACTORY_WEBAUTHN_ACCESS_GROUP` enables the configured
native authenticator; it does not create signing identities or entitlements. Native
Touch ID needs Apple silicon or a T2 Intel Mac. Linux requires a supported user-
verifying security-key/authenticator path; do not assume browser/PWA passkeys are
portable. See [Electron's native WebAuthn contract](https://www.electronjs.org/docs/latest/api/app#appconfigurewebauthnoptions-macos).
No authentication bypass or browser credential import is provided. A missing native
authenticator remains a real first-launch blocker for a physical passkey ceremony.

Before release, retain actual isolated native receipts for DMG drag/open, Linux
packages, local/remote authentication enrollment/login/logout, secure-origin/session
isolation, window close/reopen while jobs run, explicit Stop, crash restart, workflow
and native-session continuation, client-version mismatch, and successful/failed
updates. Signing/notarization/publication remain separately approved #117 stages;
this preparation workflow is not proof those checks passed.
