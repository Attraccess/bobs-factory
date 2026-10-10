# Public binary installation and publication

The supported bootstrap is downloaded over the documented HTTPS Pages endpoint:

```sh
curl -fsSL https://jappyjan.github.io/bobs-factory/install.sh | sh
```

The bootstrap is the initial trust boundary. Obtain it from that endpoint or a
reviewed immutable checkout, not from release-supplied code. It uses pinned
publisher keys and system OpenSSL to authenticate the exact manifest bytes
before reading release fields, executing a downloaded verifier or changing an
installation. Standard macOS/Linux tools and curl are required; Node, Bun, npm,
GitHub sign-in, GitHub CLI and sudo are not installer prerequisites.

Default installation selects verified stable, with a clearly labeled verified
beta fallback until the first stable exists. Nightly is opt-in:

```sh
curl -fsSL https://jappyjan.github.io/bobs-factory/install.sh | sh -s -- --channel nightly
```

Use `--version VERSION --channel stable|nightly` for an immutable exact version.
The signed version must match the requested channel. `--prefix /absolute/path`
and `--no-modify-path` retain their existing meaning. Installation keeps owned
immutable versions and an atomic executable link, preserves the prior rollback
link, and refuses foreign executables or changed installed bytes. Shell settings
are backed up before PATH changes; managed profiles are left to their owner.
Installation and launch remain separate. Factory state, workflows/results,
checkpoints, gates, worktrees, native session IDs and host credentials are never
migrated or modified by release tooling. Worker restart, update polling, per-instance
policy, pause/pin controls, desktop packages and package-manager delivery belong
to their respective follow-up tickets (#118–#124).

## Frozen candidates and channels

`candidate.json` contains a schema-1 candidate record and its SHA-256 digest.
The digest covers canonical JSON with recursively sorted object keys: product,
repository, channel, version/tag, full runtime source SHA, committed package
version, frozen workflow/tooling SHA, pinned Bun/Node recipe and all four native
targets. Stable also records its verified nightly origin, manifest digest and
provider release ID. Build run/attempt and provider artifact IDs are recorded in
`build-provenance.json` after building; they never regenerate candidate identity.

`release-channel.yml` polls hourly and supports manual preparation. It resolves
main once for nightly or the latest complete signed published nightly once for
stable promotion. Stable freezes that nightly's source even if main or nightly
advances afterward. Stable bytes embed the requested stable version and require
new native builds and byte-bound validation. Source-only assessments can be
reused only with a reviewed explanation of why they still apply.

A nightly version is `CORE-nightly.YYYYMMDD.SEQUENCE`. CORE is the committed
package core; UTC date comes from the originating workflow run's creation time;
SEQUENCE is its globally unique, increasing GitHub run ID. The frozen artifact is
restored on retries. Failed attempts retain their sequence, while later starts
reserve new run IDs. Ordering uses sequence across core changes. Reusing an
older sequence blocks preparation/publication; manual dispatch has no bypass.
Nightly requires changed main, a descendant of the last verified published
nightly, and at least six hours since successful publication. The first nightly
has no cooldown. Failed preparation does not reset the clock. A frozen candidate
that no longer matches main skips publication. Eligibility is checked inside the
repository publication lock and again immediately before making a draft public.
Preparation and publication block if the highest published nightly sequence
cannot be verified, including after signing-key rotation or with incomplete
assets. They never substitute an older verified nightly to establish source,
cooldown or sequence eligibility. Refresh trusted release tooling or repair the
release evidence before retrying.

The four targets are `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`.
Windows and musl are unsupported. Minimum OS/libc/CPU claims require observed
native execution; cross-compilation is insufficient.

## Signed release contract and discovery

New `release.json` assets use schema 2, canonical two-space JSON, product
`bobs-factory`, canonical repository, `status: available`, exact `channel`
(`stable`, `nightly`, or `beta`), `version`, `tag`, source `commit`, `buildRunId`,
`candidateDigest` and `workflowSha`. Installer, verifier, source and target
records retain `file`/hash/size (or the target archive/sidecar equivalents).
`assets` binds the complete inventory: archives, sidecars, installers,
source/rebuild archive, candidate, validation evidence/receipt archive, build
provenance and native receipts. Detached `release.json.sig` (binary RSA/SHA-256)
and `release.json.key-id` (one trusted identifier) remain outside that inventory
so signing has no circular dependency. Publisher verification signs exact bytes;
consumers never reserialize a signed pointer.

Pages verifies signatures, candidate identity, provider tag/source, complete
asset inventory and digests before preparing stable/default and nightly pointers
in one website build. `/releases/latest.json` remains the default compatibility
endpoint; `/releases/stable.json` has the same stable/beta selection;
`/releases/nightly.json` is independent. Each available pointer has matching
`.sig` and `.key-id` sidecars. Drafts, incomplete releases and untrusted signatures
are excluded. Invalid newer candidates cannot displace older valid candidates.
Transport failure aborts the build without deploying new pointers. An empty
channel produces an unavailable notice, never a fabricated download. Pagination
fails explicitly above 10,000 entries rather than selecting from an incomplete list.

Website synchronization uses the workflow's read-only GitHub token. It verifies
candidates in channel order and stops after finding each usable target, avoiding
API requests for older history. Publication ordering uses the complete published
provider list, including releases that frozen tooling cannot verify after key
rotation; an older stable candidate cannot move latest backwards.
Unsigned `pending` website metadata can only stop installation with an
unavailable-channel message. Every installable release still requires a pinned
publisher signature before release assets are downloaded or executed.

Nix takes reviewed immutable `releaseManifest`, `releaseSignature` and
`releaseKeyId` inputs. It does not fetch mutable latest during evaluation and
verifies with a pinned key before unpacking/building. Hash-pinned archives alone
are insufficient publisher authentication. Nix installations remain owned by Nix.

## Signing keys and historical beta

The reviewed inventory is `docs/distribution/release-keys.json`. It intentionally
contains no production key. **Rollout is blocked** until the authentic publisher
public key is supplied through a reviewed change and protected signing is configured.
Never invent a key, commit private keys, copy a host signing store or send credentials
in tickets. Set the protected `BOBS_FACTORY_RELEASE_SIGNING_KEY` secret and
`BOBS_FACTORY_RELEASE_KEY_ID` variable in release environments; local tools take
only `BOBS_FACTORY_RELEASE_SIGNING_KEY_FILE`, an infrastructure-owned file binding.

Identifiers are lowercase letters/digits/hyphens, at most 64 characters. Keys
use RSA of at least 3072 bits with SHA-256; `status: active` pins are accepted.
Unknown, malformed, retired or revoked keys fail closed. A downloaded key ID
selects an existing pin; it cannot introduce a key. For rotation, add the next
public key as active, run `node scripts/sync-release-keys.mjs`, review/redeploy the
bootstrap and release tooling, then sign with the new key. Keep overlapping active
keys until consumers have the new bootstrap. Retire/revoke by changing status
and rebuilding the trusted consumers. An older bootstrap must be reacquired from
the HTTPS endpoint to learn a new key; changing release metadata cannot do that.
Revocation can make old releases unavailable to updated consumers. Tests use
only ephemeral keys. `node scripts/sync-release-keys.mjs --check` detects pin drift.

Historical beta manifests remain immutable schema 1. Authenticating one requires
additive detached manifest signatures plus signed `release-attestation.json` and
its signature/key-ID sidecars, binding the exact old manifest and complete validated
asset inventory. `prepare-beta-attestation.mjs --assets IMMUTABLE_ASSETS --output
EMPTY_DIRECTORY --approval APPROVAL.json --key-id KEY_ID` validates all existing
native/source/evidence gates. Approval binds `manifestSha256`, the sorted inventory's
`assetsDigest` and `approvedBy`. It prepares additive authentication only, never
changes archives, the old manifest or tag, and never uploads anything. Separate
publication approval is required for those additive assets. Nix additionally takes
`releaseAttestation`, `releaseAttestationSignature` and its pinned key ID. Without
that genuine material, unsigned beta is unavailable and nightly never replaces it
as default. Checked-in website pointers currently show this verification blocker.

## Preparation, signing, approval and recovery

Publication is disabled by default. Do not dispatch publication, install on a
production host or provision signing secrets as part of implementation validation.

1. Freeze with `release-channel.yml`. It calls `binary-build.yml` at the same immutable
   workflow revision for native validation only. Manual builds dispatch from the
   frozen tooling ref and pass exact candidate JSON.
   The build checks out runtime source and tooling separately and uses
   `build-binary.ts --source-root SOURCE --candidate FILE --release-version VERSION`
   without editing tracked packages. Ordinary local builds still use the committed
   version. Candidate digests and run-attempt suffixes distinguish stable/nightly artifacts
   and retain previous attempts without overwriting their bytes.
2. Assemble real source/rebuild and release evidence. Use
   `build-release-source.mjs --sha SOURCE_SHA --candidate FILE --materials DIRECTORY
   --output EMPTY_DIRECTORY`; the bundle also carries candidate/recipe and exact
   tooling source. Document the version override in reviewed rebuild/relink instructions.
   Dispatch `release-evidence.yml` with candidate JSON, successful binary run ID,
   archive HTTPS URL and independently reviewed archive SHA-256. It imports receipts;
   it never invents passed or not-applicable gates. Candidate review, full-payload F1,
   migration/state preservation and licensing/source evidence must actually exist.
3. `binary-release.yml` prepares on successful evidence intake or manual dispatch.
   Preparation has read-only repository credentials and no signing secret. Inspect
   its `bobs-factory-prepared-release-DIGEST` artifact and `publication-plan.json`.
   Signing remains a reported blocker when unconfigured. Local equivalent:

   ```sh
   node scripts/publish-binary-release.mjs --candidate candidate.json --run-id RUN_ID \
     --evidence /path/to/release-evidence.json --output /path/to/empty-output
   ```

4. For stable, dispatch `binary-release.yml` with that prepared artifact ID and
   `sign_only: true`. Protected signing returns the signed publication plan in a
   retained artifact. Review its exact `assetsDigest`, then dispatch with that artifact
   ID, `publish: true` and `approved_assets_digest`. Configure required reviewers in
   `binary-stable-release`; approval binds both candidate and signed asset inventory.
   Stable publication sets GitHub latest only after all gates pass.
5. Automatic nightlies require separate rollout approval, protected environment
   `binary-nightly-release`, keys and explicit `BOBS_FACTORY_AUTOMATIC_NIGHTLIES=enabled`.
   A successful evidence workflow then signs/publishes eligible nightlies without
   per-nightly approval. Missing review/migration/F1/license evidence still blocks
   intake; the hourly poll cannot fabricate it. Manual nightlies enforce the same
   eligibility and activation. Nightlies use prerelease=true and make_latest=false.
   Automatic triggers also require the workflow entrypoint SHA to match frozen
   tooling. If workflow code advanced since evidence, manually dispatch from the
   frozen tooling ref; retain the original runtime source and prepared bytes.

All mutations share `bobs-factory-repository-publication` concurrency; builds may
run in parallel. Never run another mutation client outside that lock. Local
publication requires infrastructure to establish the same repository lock and
set `BOBS_FACTORY_RELEASE_PUBLICATION_LOCK=repository`; the marker itself does not
implement a distributed lock. A local directory lock also serializes publishers
on the same host; an interrupted owner requires inspection before clearing it. Local preparation/dry run performs no tag, draft,
upload, dispatch, channel deployment or host installation.

Recovery uses the exact retained prepared/signed artifact (`--resume` locally),
not a rebuild or refreshed clock. `publication-receipt.json` tracks candidate,
tag/release IDs, expected assets, completed stages and synchronization. Annotated
tags include the candidate digest and point to frozen runtime source. Matching
drafts/assets are reused; missing draft assets are uploaded. Different identities,
bytes, duplicate assets or incomplete public releases block without deletion or
overwrite. Ambiguous tag/draft/upload/publication responses are reconciled against
provider state. Already-public matching releases count as published; only unfinished
Pages synchronization is retried. The publisher explicitly dispatches `website.yml`
after publication because token-created release events may not start workflows.
A synchronization failure preserves publication success and prior deployed pointers;
retry the retained publication artifact. Partial/failed-run artifacts remain usable
for recovery only after fresh identity, signature and full validation checks.

Artifact transport is authenticated for maintainers only. End users never receive
`GH_TOKEN`. `--artifact-zips DIRECTORY` supplies offline TARGET.zip build artifacts
whose digests must still match provider provenance. No repository token is forwarded
to signed archive storage or operator-supplied evidence URLs.

## Required evidence

`release-evidence.json` has `schemaVersion: 1`, `product`, exact `version`,
`commit`, `buildRunId`, `candidateDigest` and `workflowSha`. Each validation record has a `status` and
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
FULL_SHA --candidate FILE --materials DIRECTORY --output EMPTY_DIRECTORY`. The input directory
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

## Installer validation and delivered desktop assets

The native matrix also runs `scripts/smoke-public-install.mjs` against the freshly
built archive with controlled downloads and synthetic signing keys. It verifies
channel/exact-version resolution, repeat installation, signature rejection and
preservation of the existing executable when hash, size, source or target checks
fail. This does not exercise production signing keys or public GitHub downloads.
New prepared manifests declare `publicInstallerValidation: 1`; publication and
recovery require each target's matching `public-installer-TARGET.json` receipt,
including the frozen candidate digest and tooling SHA. Older signed manifests
without this extension remain readable; their immutable assets are never rewritten.

Desktop packaging remains owned by its separate delivery. When evidence includes
`desktop: {schemaVersion: 1, artifacts: [...]}`, each item declares the same exact
version, source commit and channel, a unique target and observed
`platformRequirements`. Its `archive`, `updateMetadata` and `validation` records
carry file, size and SHA-256. Preparation copies and validates all three assets;
the validation JSON must report `product: "bobs-factory"`, `status: "passed"`,
matching version/commit/channel/target, `candidateDigest` and `workflowSha`.
All records must also match the signed `assets` inventory. Missing, duplicated or
altered validation receipts block discovery and stable promotion. Recovery checks
the receipt identity again. No desktop downloads are advertised until delivered.

Receipt archives use canonical USTAR headers and fixed metadata so the same receipt
bytes produce the same archive across retries on different hosts. Publication
recovery still reuses the exact retained prepared assets and never rebuilds them.
