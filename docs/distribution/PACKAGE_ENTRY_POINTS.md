# Desktop packages and trial launcher

The [downloads index](https://jappyjan.github.io/bobs-factory/downloads/) is the
maintained availability page. Recipes and publication preparation do not establish
availability. No tap, AUR package or npm identity is currently claimed as published.
The desktop lane owns DMG/AppImage/DEB generation and native validation.

## Preparing a release's entry points

After protected signing and immutable publication have completed, a release
maintainer runs this read-only generator from the reviewed checkout:

```sh
node scripts/generate-package-recipes.mjs --version EXACT_VERSION --output /tmp/bobs-entry-points-EXACT_VERSION
```

It uses the existing publisher signature, candidate, source tag and complete asset
inventory verifier. It requires all four desktop targets and downloads/verifies the
matching DMGs, AppImages and DEBs before emitting desktop recipes. `--kind npm` prepares only the launcher from a
complete verified native release, independently of desktop delivery; `--kind desktop`
prepares only the desktop recipes. The default `all` requires both. URLs contain the exact
version tag, never a mutable latest/nightly pointer. Missing, unsigned, partial or
conflicting packages fail closed. `verification.json` binds generated recipes to
the release manifest digest, publisher, candidate, commit and byte checksums.
The minimum desktop targets are macOS 13+ and Linux glibc 2.35+, ARM64/x64,
subject to the desktop lane's native proof. Windows and musl are unsupported.

The generated material contains:

- Project-tap casks `bobs-factory` and `bobs-factory@nightly` (one selected channel
  per invocation). The intended tap is `jappyjan/bobs-factory`; the operator must
  create and secure the `homebrew-bobs-factory` repository before advertising it.
  Review with `brew style`/`brew audit --cask`, then test both CPU targets on isolated
  native hosts. Casks install `Bob's Factory.app` and conflict with the other track.
- AUR `bobs-factory-desktop-bin` / `bobs-factory-desktop-nightly-bin` PKGBUILD and
  `.SRCINFO`, with ARM64/x64 DEB payloads and fixed checksums. `makepkg` extracts
  package payloads without invoking DEB maintainer scripts. Verify `.SRCINFO` with
  `makepkg --printsrcinfo`, then build/install/remove in clean Arch chroots before
  submitting to authenticated AUR repositories. Both provide/conflict with the
  same desktop identity. They do not enroll a service or delete Factory state.
- An npm package with the release's exact version and default runtime selection.
  `latest` is reserved for stable; `nightly` for nightly. The emitted package is
  deliberately `private: true` until registry ownership is proven. A launcher tag
  selects a frozen runtime by default; explicit `--channel` follows that signed
  channel, while `--version` freezes one release. It has no native executable cache: every run
  stages verified bytes in a temporary prefix, removed on exit. npm's launcher
  cache does not make its downloaded runtime permanent.

Release maintainers own recipe refresh after each verified release, tap reviews,
and AUR/npm submissions. These operations are separate from binary publication;
no generator publishes, signs or mutates package-manager installations. Retain
verification material in each distribution PR. Do not add live commands/download
links until the corresponding reviewed package is actually available.

## npm ownership and operator publication gates

`bobs-factory-trial` is the proposed minimal launcher identity. Availability of a
name is not project ownership. An authorized npm publisher must confirm `npm whoami`
and `npm owner ls bobs-factory-trial --registry https://registry.npmjs.org`, establish
ownership or choose a reviewed Bob-owned scope, and review the exact pack inventory.
No registry credential is required or read during implementation validation.
Only after ownership, immutable runtime trust, review and native trial evidence
may the operator remove `private`, run `npm pack --dry-run`, and publish the exact
prepared version with the appropriate `latest` or `nightly` dist-tag/provenance.
Do not revive archived upstream publication or publish private workspace packages.

## Ownership, launch and removal

The npx trial owns `~/.bobs-factory-trial`, an exclusive launcher lock and dashboard
port 4560 (webhooks 4561); `--port` selects another pair. It starts guided local
setup and opens the browser; `--no-open`/`--headless` prints the dashboard URL instead.
Factory arguments follow `--`, but cannot override the trial home/port. Normal
instance config/work, global CLI paths, native credentials and services are retained.
The existing packaged runtime may cache verified immutable embedded resources in
`~/.bobs-factory/resources`; trial cleanup never deletes that shared cache.
A second trial refuses the lock; occupied ports fail before starting a worker.
After an interrupted/killed launcher inspect the retained lock and stop any worker
before removing it. Ctrl-C/TERM is forwarded to the foreground runtime; state
remains reusable. Delete the separate trial home only deliberately after stopping
it; native agent credentials/conversations are not within that home.

Homebrew, DEB and AUR own executable replacement/removal. Their runtime updater
must report external ownership and direct operators to that manager. A user-owned
AppImage and bootstrap executable have distinct owned-update capabilities; neither
may take over an external service. Service enrollment is always explicit.

For a bootstrap install, optionally pass `--home ABSOLUTE_HOME` to hand off to
`bobs-factory --home HOME update settings`. An explicitly selected channel is
passed through; a policy is passed only with explicit `--update-policy manual` or
`idle-auto`. Reinstallation without these choices never resets overrides/pause/pin.
Without a saved override, stable defaults to manual notification and nightly to
idle automatic installation. The handoff starts no worker. Existing older signed
verifiers/runtimes may lack this command: installation remains valid, but a failed
handoff is reported separately; check status before launching. Exact-version
selection installs that version; ongoing pinning uses `update settings --pin VERSION`.

After draining/stopping the worker and disabling service restart:

```sh
sh scripts/uninstall-binary.sh /absolute/user/prefix --stopped
```

Removal shares the install lock, validates all receipts/builds/links before deletion,
and refuses foreign paths, redirected stores and modified executables. It removes
only receipt-owned versions and the active owned link. Unknown store files, PATH
entries, rollback-independent backups, Factory state and native credentials remain.
Inspect pre-receipt legacy installs manually rather than inferring ownership.
