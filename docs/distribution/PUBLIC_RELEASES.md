# Public binary installation and publication

The public installer requires curl and standard macOS/Linux tools. It does not
require GitHub sign-in, `gh`, Node, Bun or sudo. The supported command is:

```sh
curl -fsSL https://jappyjan.github.io/bobs-factory/install.sh | sh
```

It selects the native target, verifies the downloaded archive, sidecar and
matching verifier, installs under `~/.local`, and configures the user's shell
PATH. Existing shell settings are backed up before appending. Managed symlinked
or read-only profiles are left to their owner. The final output includes the
full launch path, which works immediately in the current terminal. New terminals
can use `bobs-factory` by name. Git and coding-agent preparation are onboarding
concerns, not dependencies of the installer.

For an explicit version or custom prefix, download the script and run
`sh install.sh --version VERSION --prefix /absolute/path`. `--no-modify-path`
keeps shell profiles untouched. The installer never changes factory state or
services, replaces a foreign executable, or overwrites a different immutable
version. A repeat install verifies the installed bytes and preserves the previous
rollback link. Drain and stop an existing worker before intentionally replacing
its executable; older versions remain available for manual rollback.

## Shared metadata

`scripts/install.sh` is canonical. The Pages build copies it to `/install.sh`.
The homepage and installer consume `/releases/latest.json`; Nix can pin the same
`release.json` asset at an immutable release tag and its hash. No consumer needs a
workflow-run ID or manually copied platform hash in its own configuration.

Before the first approved public release, metadata has `status: "pending"` and
the homepage explains availability. The installer fails with the same guidance.
Do not advertise a currently unavailable public binary as downloadable.

An available manifest is schema version 1, with product `bobs-factory`, repository
`jappyjan/bobs-factory`, `status: "available"`, exact `version`, matching `tag`,
full immutable `commit`, and integer `buildRunId`. `installer`, `verifier` and
`source` each contain `file`, `sha256` and `size`. The `targets` object contains
all four `darwin-arm64`, `darwin-x64`, `linux-x64` and `linux-arm64` entries. Each
entry has `archive`, `archiveSha256`, `archiveSize`, `manifest`,
`manifestSha256` and `manifestSize`. Filenames are fixed by the product/version/
target contract, and the download origin is always the canonical repository's
immutable release URL. Hashes verify bytes; trust in publication remains rooted
in that repository and the HTTPS Pages endpoint.

New manifests include `channel: "stable"` or `"prerelease"`, matching their exact
version. Pages chooses the highest verified stable binary release. Before a
stable binary release exists, it chooses the highest verified prerelease, such
as `1.0.0-beta`, and the homepage and installer label it accordingly. Drafts and
releases without the shared manifest are never install candidates. GitHub's
[`releases/latest` endpoint](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)
excludes prereleases, so Pages reads the public release list instead. Beta
publication leaves GitHub's stable latest designation unchanged. An explicit
`--version 1.0.0-beta` always pins that immutable version.

The publisher emits canonical JSON with two-space indentation and one property
per line. Preserve that formatting: the portable installer parses this narrowly
defined format without a JSON runtime. The JavaScript metadata validator checks
the full schema before Pages writes the public pointer. Pages verifies the
GitHub release asset digest and the asset inventory against the same manifest.

## Maintainer publication

The build workflow remains build/verification only. Publication is a separate
operation, after the user has reviewed the implementation and approved a release.
This implementation does not turn the older preview into a published release.

1. Commit the exact CLI version and review the full candidate SHA. Dispatch
   `binary-build.yml` from a ref whose head is that SHA, selecting the same full
   SHA and version. All four native jobs must succeed.
2. Gather real release validation and source/rebuild material. Package
   `release-evidence.json`, `source-rebuild.tar.gz` and the referenced receipt
   files under `release-evidence/` in a tar.gz archive. Dispatch
   `release-evidence.yml` from the exact candidate ref with its SHA, exact
   version, successful binary build run ID, HTTPS archive URL and independently
   checked archive SHA-256. It checks the candidate, four-target build provenance,
   archive safety and every existing evidence gate, then uploads
   `bobs-factory-release-evidence-SHA`. It never generates passed statuses or
   human waivers. Keep material free of secrets; no repository token is sent to
   supplied storage. The evidence downloader requires this specific successful
   candidate workflow, its artifact digest and exact source SHA.
3. Dispatch `binary-release.yml` with the candidate, version, build run ID and
   evidence artifact ID, leaving `publish` false. Inspect the uploaded public
   assets and `publication-plan.json`.
4. After separate release approval, run the same workflow with `publish` true.
   It verifies the existing CI ZIP digests and archives; it never rebuilds the
   candidate. A new tag points to the reviewed SHA, assets are uploaded to a
   draft release, their digests are checked, then the draft is published.

For local dry runs, the equivalent maintainer command is:

```sh
node scripts/publish-binary-release.mjs \
  --sha FULL_SHA --version VERSION --run-id RUN_ID \
  --evidence /path/to/release-evidence.json --output /path/to/empty-output
```

The publisher requires `jappyjan/bobs-factory` to be publicly accessible, checks
visibility during validation, and checks again before tag creation and publication.
Private/internal repositories cannot serve anonymous release downloads. Changing
repository visibility is a separate maintainer decision; the publisher never
changes it. Pages also reads release metadata and assets without authentication.

Maintainer artifact retrieval/publication uses `GH_TOKEN`. End users do not need
that token or the GitHub CLI. For offline artifact verification, provide
`--artifact-zips DIRECTORY` containing `TARGET.zip` for all four targets. Their
hashes must match the authenticated GitHub artifact metadata.

The version/tag must not exist already, and the version must be newer than the
current stable release. Old releases and assets are retained. Failed publication
retains the tag and any draft for inspection; it never silently deletes a tag,
overwrites assets or moves stable backwards. Use a new version for a corrected
release. The publisher explicitly dispatches Pages after success because
`GITHUB_TOKEN`-created release events do not start other Actions workflows. If
that final dispatch fails, the release remains published and Pages can be run
manually. No automatic update daemon is added.

## Required evidence

`release-evidence.json` has `schemaVersion: 1`, `product`, exact `version`,
`commit` and `buildRunId`. Each validation record has a `status` and
`receipt: { file, sha256 }`, with a receipt inside the evidence directory:

- `reviewedCandidate`: `passed`.
- `fullPayloadF1`: `passed` or `not-applicable`, with the documented applicability
  assessment for the entire runtime payload since the previous release.
- `migrationPreservation`: `passed`, covering home/config and native continuation.
- `licensingAndSource`: `passed`, covering complete notices and exact runtime,
  dependency source/rebuild obligations.
- `targets[TARGET].preparedAgents`: `passed`, referencing the candidate-bound
  `prepared-agent-boundaries.json` from that target's native build. The required
  validation uses mocked agents and controlled protocols. Legacy `waived` records
  retain their `approvedBy` and scope when publishing an already verified candidate.
- `targets[TARGET].nativeHelpers`: `passed` for every target.

Native startup/dashboard/protected API/MCP/shutdown/restart receipts are retrieved
directly from each successful native binary build artifact, alongside
`native-helpers.json` and `prepared-agent-boundaries.json`. Native helper identity
and executable hash must match the verified archive. Scripted adapter boundary
checks and synthetic GitHub credentials satisfy the release's controlled test scope;
they do not claim authenticated coding-agent execution. Live provider tests are
manual-only and require explicit approval for the specific test. Releases never
require them or a recurring live-test waiver. Missing validation,
ambiguous artifacts, dirty builds, checksum mismatches or different source SHAs
block staging and publication.

The evidence `source` record names `source-rebuild.tar.gz` with SHA-256 and byte
size. The archive contains regular files/directories under `source-rebuild/`,
including `commit.txt` with the candidate SHA, `README.md` with precise rebuild
instructions, `pnpm-lock.yaml`, and the pinned runtime source
`bun-source.tar.gz`. Include the exact factory/dependency sources and any other
material identified by the licensing review; these files are a minimum inventory,
not a substitute for that review. Evidence and receipt hashes accompany the public
release so the exact approval and validation remain inspectable.

To assemble reviewed material, use `scripts/build-release-source.mjs --sha
FULL_SHA --materials DIRECTORY --output EMPTY_DIRECTORY`. The input directory
contains precise reviewed rebuild/relink instructions in `README.md`, regular
source files/archives, and `source-materials.json` with `schemaVersion: 1`, exact
`commit`, `bunVersion: "1.4.2"` and `records`. Each record names its `kind`, flat
`file`, HTTPS `source`, exact `revision`, byte `size` and `sha256`. Include a
`bun` record named `bun-source.tar.gz`, the exact patched `webkit` source and
any corresponding dependency/library source required by the licensing review.
The tool adds `factory-source.tar.gz`
from the exact committed Git tree, its lockfile, commit and material inventory,
then emits `source-rebuild.tar.gz` and its `source-record.json`. These integrity
checks do not establish license completeness; that remains a separate reviewed
`licensingAndSource` receipt.

Bun's [pinned license/relink instructions](https://github.com/oven-sh/bun/blob/bun-v1.4.2/LICENSE.md)
identify statically linked JavaScriptCore/WebKit and TinyCC LGPL requirements.
The [pinned build source](https://github.com/oven-sh/bun/blob/bun-v1.4.2/scripts/build/deps/webkit.ts)
selects WebKit commit `2e2aa2290fac856d6f451ceacb58f7f5b44dd057`.
The Bun source archive alone is insufficient: include the patched library source
and the object/source/rebuild material required to permit relinking. Review
other bundled libraries against the exact runtime, and include dependency
notices identified by the binary's `THIRD_PARTY_NOTICES.txt`. Retain factory
Apache-2.0 attribution. The operator's proprietary Cursor installation remains
outside distributed archives.

Current release blockers described in [RELEASING.md](../../apps/cli/RELEASING.md)
remain blockers until the corresponding real evidence is supplied. No missing
coverage is marked passed by the publisher.
