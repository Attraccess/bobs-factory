# Desktop candidate preparation

The native shell reuses the Factory web UI and authenticated APIs. Its launcher
opens the local Factory or an explicit remote HTTPS origin. Local launch offers
the existing protected passkey/repository/provider onboarding, without installing
agents or moving their native credentials. Each dashboard origin has a separate
persistent Electron session. Factory web contents have sandboxing, context isolation,
no Node integration and no privileged preload. Only the packaged launcher has a
one-operation connection bridge; sender/frame/URL are checked by the main process.
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
System/external managers must own their upgrades; unattended replacement of an
installed desktop app is not yet validated. Update policy/runtime belongs to the
shared per-instance updater; connecting to hosts must never update them together.

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

The packaged runtime includes native runtime/dependency notices and source/rebuild
material; the Electron shell retains upstream attribution and Electron/Chromium
license material. Actual release/license evidence must cover both.

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
