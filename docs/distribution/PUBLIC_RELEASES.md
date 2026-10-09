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

## Separate channels and immutable identity

The homepage displays stable and nightly independently. `/releases/stable.json`
and `/releases/nightly.json` each select a complete validated release, or explain
that the channel is unavailable. Install the selected channel explicitly:

```sh
curl -fsSL https://jappyjan.github.io/bobs-factory/install.sh | sh -s -- --channel stable
curl -fsSL https://jappyjan.github.io/bobs-factory/install.sh | sh -s -- --channel nightly
```

`--version VERSION` pins the immutable release. Combining it with `--channel`
requires agreement. The default remains stable, through `/releases/latest.json`.
That compatibility endpoint retains the reviewed legacy beta fallback before the
first stable, labels it as a prerelease, and **never selects nightly**. Explicit
stable selection never falls back to beta or nightly. There is no update polling,
service replacement, pause/pin change or state migration in this installer.

Immutable schema-1 releases remain readable. Their generic prerelease versions,
such as `1.0.0-beta`, are not nightlies. New candidates use schema 2 and explicit
`stable` or `nightly` channels. A nightly version ends in `-nightly.N`, where `N`
is a positive monotonic integer. Channel ordering is independent: numeric nightly
sequence orders nightlies; SemVer orders stable releases. No timestamp-only ordering
or Windows/musl/minimum-platform claim is made.

A schema-2 manifest retains `product`, canonical `repository`, status, version,
tag, candidate `commit`, build run ID, installer/verifier/source records and all
four targets. It adds `originatingSourceSha`, UTC `createdAt`, and either
`nightlySequence` or `promotedFrom` (selected nightly tag, version, candidate commit
and manifest SHA-256). `supportingAssets` records hashes and sizes for every
mandatory evidence/provenance/native receipt. The portable installer requires
canonical two-space JSON. It reads root identity separately from nested promotion
provenance. Nix continues to pin immutable `release.json` assets and accepts both
schema versions. Historical assets are never rewritten.

Pages completely paginates release discovery within a 1,000-release bound and
validates manifest digests and complete inventories before writing any channel
pointer. A missing asset, digest mismatch or exceeded bound fails the build and
leaves the deployed site unchanged. The canonical GitHub repository and HTTPS
Pages origin establish the publisher boundary; checksums establish byte integrity,
not a signing identity.

## Candidate preparation and authorization

`release-candidate.yml` checks every 30 minutes, but its scheduled job is disabled
unless the repository variable `BOBS_FACTORY_RELEASE_AUTOMATION` is exactly
`enabled`. **Do not set it until separately authorized rollout.** No production
ref, release or repository visibility was changed to implement this feature.
Manual preparation defaults to a dry run with read-only permissions. It writes
local candidate objects/records without pushing refs, dispatching builds, publishing
assets or deploying Pages. For a local nightly preview:

```sh
node scripts/prepare-release-candidate.mjs --channel nightly \
  --source FULL_MAIN_SHA --sequence NEW_SEQUENCE --output EMPTY_DIRECTORY
```

Authorized orchestration captures main once. It reserves the next numeric identity
in a permanent `release-candidates/nightly/N` branch before the native matrix starts.
The candidate changes only `apps/cli/package.json` version and `bobsFactoryRelease`
metadata over the frozen source. Candidate records and branches are reused on
retries. Even failed reservations consume their sequence; they never count as
successful publication. Manual and scheduled nightlies require changed originating
main and at least six hours since the last **successful publication**, rechecked
immediately before mutation and after uploads. Manual publication cannot bypass
that cooldown. The repository-wide `bobs-factory-publication` workflow concurrency
group serializes decisions, including manual publication; running uploads are not
cancelled by new attempts. Never invoke competing local publishers outside that lock.

Stable preparation requires `--channel stable --nightly EXACT_TAG --version VERSION`.
It revalidates a complete public schema-2 nightly and its tag/manifest identity,
creates a new version-only candidate directly from that nightly candidate, and
builds fresh stable artifacts. It excludes newer main changes and never relabels
nightly binaries. Stable publication must run through the `stable-release` GitHub
environment. Configure required reviewers and prevent self-review: the publisher
checks those protection rules and rejects an unprotected environment. A workflow
input boolean alone is not the approval boundary. Stable releases retain individual
human release approval; authorized nightlies do not need individual release approval.

## Real evidence and publication

The orchestrator dispatches the existing `binary-build.yml` at the immutable
candidate branch and waits for all four native targets. Each job validates binary,
installer, runtime, protected API/MCP, scoped helper and simulated-agent boundaries.
The public installer also runs against the freshly built native archive through a
controlled download transport, with exact version, channel, repeat installation,
bad hash and unavailable-target preservation checks. These are native CI receipts,
not local synthetic-archive evidence. No live provider inference is required.

Source review, full-payload F1 assessment, migration preservation and licensing
are independent required gates. The candidate's deterministic version-only change
is checked separately from its underlying source. Compilation does not create
passed review receipts. Use the existing source-material builder and reviewed
`release-evidence.yml` intake; source/license reuse must still be valid for the
exact dependency/runtime payload and freshly assembled candidate source material.
There is no automatic assertion of license completeness or review approval.

When real evidence is absent, orchestration stops visibly with the exact candidate,
version and build run needed for intake. Import the reviewed archive through
`release-evidence.yml` dispatched from that candidate ref. Retry the candidate
workflow after intake; it finds the successful candidate-bound evidence artifact,
checks its build ID, and runs the frozen candidate publisher. The intake URL/hash
and all receipts must be independently reviewed; no secrets belong in material.

`binary-release.yml` supports independent dry-run staging from candidate SHA,
version, successful build run and evidence artifact ID. Preparation has read-only
permissions. Publication uses a separate write-permission job, with the channel's
approval/rollout boundary. The publisher never rebuilds binaries. Local staging:

```sh
node scripts/publish-binary-release.mjs \
  --sha FULL_SHA --version VERSION --run-id RUN_ID \
  --evidence /path/to/release-evidence.json --output /path/to/empty-output
```

Dry run stages the same public inventory and `publication-plan.json` without any
mutating GitHub request. Maintainer artifact access uses `GH_TOKEN`; anonymous
installation does not. `--artifact-zips DIRECTORY` supplies already downloaded
`TARGET.zip` files, whose digests must match GitHub artifact metadata. The publisher
checks public canonical repository visibility but never changes it.

## Interrupted publication and immutable conflicts

Publication verifies or creates the candidate tag and matching draft, uploads only
missing assets, checks the complete inventory and tag again, then makes the release
public. A marker binds candidate/version/build and all staged hashes. Existing assets
must have exactly the same names, sizes and digests; duplicate, foreign or changed
assets stop recovery without deletion or overwrite. Receipt archives have canonical
headers so restaging the same receipts does not change their bytes across hosts.
Use a new candidate/version when any staged bytes must change.

Retry with the same candidate, build, evidence and a fresh local staging directory.
Matching drafts resume; identical complete releases succeed without uploading or
republishing. Incomplete releases remain drafts and discovery remains unchanged.
Nightlies use GitHub prereleases with `make_latest: false`. Only a forward, complete,
approved stable release may move stable latest.

`publication-phases.jsonl` retains candidate/version/build and completed phase details,
and workflows retain staging records even on failure. The publisher explicitly
starts `website.yml` after publication. If Pages dispatch fails, retrying the identical
publication only dispatches Pages; alternatively run `website.yml` manually. A
Pages-only retry does not require rebuilding, republishing or moving the tag.

## Desktop extension boundary

No desktop downloads are advertised until #121 delivers validated packages.
An optional `desktop` inventory is versioned separately and records each delivered
artifact's exact version, candidate commit, channel, target, platform requirements,
archive and channel update metadata with hashes/sizes. Those assets must validate
alongside the CLI inventory before discovery. Missing desktop validation blocks that
desktop delivery, not the four-target CLI pipeline when no desktop is shipped.
Signing/notarization and platform minima remain #121's contract. Broader bootstrap,
update activation/policy/recovery, service integration and package-manager delivery
remain #118–#124 work; upstream workspace npm publishing stays retired.

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

Schema-2 releases also retain `public-installer-TARGET.json` from the native matrix.

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
