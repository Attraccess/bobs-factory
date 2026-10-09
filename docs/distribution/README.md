# Binary distribution

Install with the [two-command quick start](../../README.md#install-and-start).
The public installer detects your OS/CPU and downloads a verified version without
GitHub login, GitHub CLI, Node or Bun. First launch opens protected browser setup
for a project, prepared agent and GitHub connection. Agents may have their own
runtime and login requirements.

The shared [`release.json` contract](PUBLIC_RELEASES.md) drives the installer,
homepage and Nix package. The installer selects verified stable releases, or the
latest verified beta before the first stable release. When no reviewed release is
available, the homepage and installer report unavailable downloads. CI artifacts
remain maintainer validation material.

The artifact contract is `bobs-factory-VERSION-TARGET.tar.gz` with a matching
`.manifest.json`: schema version, product, exact version, commit, target, byte size
and SHA-256. `build.json` inside adds tooling, executable hash and resource digest.
The same verified commit, target and resource digest are embedded in the runtime
identity returned by `/version` and `/api/version`, alongside the product
version and dirty-build flag. Development runtimes report unknown source identity;
the current Git checkout is not evidence of the installed executable's commit.
Run attempt provenance retains the identity that actually executed each attempt,
including when a frozen run resumes after an upgrade.
Supported target names: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`.
Bun 1.4.2 bundles the runtime; immutable dashboard/prompts/skills are embedded and
verified before extraction into a content-addressed private resource directory.

```sh
pnpm install --frozen-lockfile
pnpm --filter 'bobs-factory...' build
bun run scripts/build-binary.ts --target darwin-arm64 --output /tmp/factory-build
factory_version=$(node -p 'require("./apps/cli/package.json").version')
./scripts/smoke-binary.sh "/tmp/factory-build/bobs-factory-$factory_version-darwin-arm64/bobs-factory"
```

Compile success is not runtime evidence. Native-target smoke must check isolated
startup, dashboard shell/assets/API, scoped MCP access, shutdown and restart.
Prepared-agent execution needs additional validation. The archive contains no
Cursor SDK, native Cursor programs or rebundled SDK chunks. The factory-owned
permission hook invokes the factory executable. Cursor runs in a separate process
using the operator's prepared SDK and Node installation; other agents use their
prepared launchers. The installer verifies the whole archive and rejects traversal,
duplicate entries and special files.

### Prepared Cursor installation

For binary installations, prepare `@cursor/sdk@1.0.19` and
`@connectrpc/connect-node@1.7.0` together in a directory owned by the service account.
Use Node >=22.13 as required by that SDK. This is an agent prerequisite; the
factory and its internal MCP helper still run without Node/npm/Bun. For example,
using your existing npm setup:

```sh
npm install --prefix ~/.local/share/bobs-factory-cursor @cursor/sdk@1.0.19 @connectrpc/connect-node@1.7.0
```

Set these in the service environment or `<factoryHome>/.env`:

```sh
BOBS_FACTORY_CURSOR_SDK_PATH=~/.local/share/bobs-factory-cursor/node_modules/@cursor/sdk
BOBS_FACTORY_CURSOR_NODE=/absolute/path/to/node
```

`BOBS_FACTORY_CURSOR_NODE` defaults to `node` on PATH. Keep Cursor authentication
in its supported account configuration (`CURSOR_API_KEY`); do not send credentials
in tickets. The adapter checks the SDK version before starting. Native session IDs,
MCP options, events, usage and cancellation cross a private process IPC channel.
Missing preparation fails with setup guidance; no automatic installation occurs.
Checkout development continues to use its own installed SDK. This change does
not relocate or convert native conversations. Authenticated Cursor validation was
waived by the human for this implementation; it is not claimed as passing evidence.

Linux builds target glibc. macOS minimum version, minimum glibc and native/CPU
constraints need native-runner evidence; musl and Windows are not claimed.
Official packaging references: [Bun executables](https://bun.sh/docs/bundler/executables)
and [Node SEA fallback](https://nodejs.org/api/single-executable-applications.html).
Bun reached actual worker startup; resources/helpers require the explicit boundary
implemented here. Node SEA has not been selected or validated as a fallback.

## Attribution and rebuilding

Archives retain Apache-2.0 source attribution and aggregate full dependency notices
in `THIRD_PARTY_NOTICES.txt`. Supplemental upstream license snapshots have source
URLs and SHA-256 provenance in `licenses/sources.json`. The build rejects bundled
Cursor modules and does not copy agent installations into the archive.

Bun links LGPL JavaScriptCore/WebKit and other libraries. Its full license guidance
and linked-library notices accompany candidates. To rebuild with modified libraries,
use the [Bun 1.4.2 source](https://github.com/oven-sh/bun/tree/bun-v1.4.2) and its
[relink instructions](https://github.com/oven-sh/bun/blob/bun-v1.4.2/LICENSE.md), then
build this repository's exact candidate and lockfile with that runtime. Distribution
must include the exact source/rebuild material needed for the selected runtime;
the later publication role must verify this alongside license completeness. Local
development candidates are not a completed release compliance package.

Cursor's proprietary SDK and native sidecars remain in the operator's separately
prepared installation. Bob’s Factory does not redistribute or modify those files.
The archive's runtime dependency inventory excludes them.

## Installation and manual replacement

The public installer is the primary installation path. For maintainer validation
or manual replacement, download an exact version's archive, matching manifest and
`install-binary.sh` from the same trusted release. When validating CI artifacts,
retrieve the verifier from the immutable candidate's source commit. The SHA-256
manifest verifies downloaded bytes; trust the release source as well. Run:

```sh
sh install-binary.sh ARCHIVE.tar.gz ARCHIVE.manifest.json ~/.local
export PATH="$HOME/.local/bin:$PATH"
bobs-factory --version
```

The installer keeps immutable versions under `PREFIX/lib/bobs-factory/` and
atomically switches `PREFIX/bin/bobs-factory`. It retains the prior version/link
for manual recovery. State is never stored under the prefix. Stop intake, drain
and stop workers/descendants before replacing the active executable. Verify one
worker, preserved home/config and continuation after restart. To roll back, stop
replacement consumers, point the executable link to the retained previous version
and restore separately backed-up mutable state only if needed. Do not run old and
new workers together. Automatic polling/updating is deferred.

The binary CI workflow remains build/verification only, with immutable candidate
input. The separate [public release workflow](PUBLIC_RELEASES.md) defaults to a
dry run and publishes only explicitly approved, fully validated immutable artifacts. Upstream
npm publishing scripts/workflow are retained as historical files in `scripts/archive`;
they are not supported fork commands. Future publishing must retain the exact
reviewed candidate, all-target evidence and manifest checks.

## Nix from the same release manifest

Pin a reviewed release's `release.json` as a file in your Nix configuration.
[`nix/package.nix`](../../nix/package.nix) selects the platform and fixed archive
checksum from that manifest:

```nix
bobs-factory = import /path/to/bobs-factory/nix/package.nix {
  inherit pkgs;
  releaseManifest = ./bobs-factory-release.json;
};
```

The package fetches public versioned assets without GitHub credentials. An
unavailable manifest fails evaluation clearly. Update the pinned manifest when
upgrading; avoid fetching a mutable latest pointer during evaluation. Keep the
service's home, environment and conversations separate from the immutable Nix
package, and drain/stop the old worker before an intentional upgrade.

Verified channel publication uses immutable candidates and separate stable/nightly
metadata. Scheduled automation stays disabled until separately authorized rollout;
stable promotion selects an explicit published nightly and requires protected release
approval. See [the public release operations](PUBLIC_RELEASES.md) for preparation, real evidence,
six-hour nightly eligibility, upload recovery and Pages-only retries.
