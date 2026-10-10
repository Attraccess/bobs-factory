# Candidate source/rebuild preparation

This lane prepares inputs for the maintained [release contract](../PUBLIC_RELEASES.md).
It does not issue licensing approval. It was implemented from frozen PR89 source
`58cb5e40a5f47bd9508f99c49067c5bc458a8dcc`; that implementation base is not a
new frozen release candidate and does not supersede the historical ed7/23/58 receipts.

[Verified upstream inputs](verified-upstream-inputs.json) records actual downloads
from official repositories, their byte lengths and SHA-256 values. Large files are
retained outside Git in `/tmp/bobs-factory-source-assets-116/`. Bun 1.4.2 resolves to
`744846f844374847c902b5e7fd59b4342a51ef99`; its dependency scripts pin patched WebKit
`2e2aa2290fac856d6f451ceacb58f7f5b44dd057` and TinyCC
`05f0fafaa3be31e31d7b4b5c17dc60f62c991171`. The downloaded license and TinyCC patch
were compared byte-for-byte with the Bun source archive. The TinyCC COPYING snapshot
was compared with its archive. The WebKit license snapshot is not WebKit source.

The codeload request and one bounded official GitHub tarball API attempt both returned `HTTP 422: Content creation is blocked` on
2026-10-10. The official `autobuild-<revision>` release has native prebuilt archives,
not a source bundle. These do not replace corresponding source or Bun application
objects. No WebKit source hash or completed source/rebuild archive is claimed here.
The alternate API error body is retained as an unaccepted diagnostic file, not a
source-material record.

To reacquire the recorded bytes, download each manifest `source` to a fresh directory
using `curl --fail --location --max-time 180 --max-filesize 268435456`; compare both
size and SHA-256 with the retained record before accepting them. Never replace an
existing verified file silently. GitHub archive bytes may change without a source
revision change: retain mismatches for inspection and review new hashes explicitly.
A source fetch is not a credential or production operation.

## Remaining build inputs and cost boundary

Obtain the complete patched WebKit source at the exact pin from the official
`oven-sh/WebKit` repository. If codeload remains blocked, first estimate the shallow
Git transfer and working-tree size; use a disposable directory, fetch the exact
commit and verify `HEAD`. Retain a complete archive with root
`WebKit-2e2aa2290fac856d6f451ceacb58f7f5b44dd057/`, including the relevant build
scripts and license files. Do not relabel a sparse checkout as complete source.
The validator checks recognizable files and pins, not completeness of every blob;
a reviewer must compare source/archive inventory to the upstream commit. Source intake rejects external link targets and special files; inspect
nested source links again before extraction. Validation never extracts or executes these
upstream archives.

No full Bun/WebKit compilation was attempted on this host. The release asset list
alone puts ordinary native WebKit prebuilts at roughly 193–432 MiB per supported
target; it does not estimate a local source build. A full source build also requires
the exact supported compiler/toolchain, SDK/sysroot, generated dependency sources,
headers and libraries, and substantial disk/CPU time. Plan that work on disposable
native build hosts after estimating it. Do not download every profile or start a
multi-gigabyte build merely to satisfy a record shape.

Use the pinned Bun source's own prerequisites and build scripts. Its
[LICENSE.md](https://github.com/oven-sh/bun/blob/744846f844374847c902b5e7fd59b4342a51ef99/LICENSE.md)
describes cloning patched WebKit, `bun sync-webkit-source`, and `bun run build:local`
for modified-library relinking. These are upstream instructions, not an observed
successful rebuild here. Review the pinned `scripts/build/deps/webkit.ts`,
`tinycc.ts`, configuration and compiler scripts before selecting native flags;
record exact commands and actual compiler/version rather than copying generic
flags. Preserve the supplied TinyCC `tcc.h.patch` and inventory any further patches.
The Bun license names JavaScriptCore/WebKit and TinyCC as LGPL-linked components;
this document does not infer requirements for every Electron/Chromium component.

For each `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64` target, retain:

- Exact distributed Bun runtime SHA-256 and Factory executable SHA-256, tied to
  final `build.json` and native archive receipts, not the implementation checkout.
- Exact compiler name/version, native/ABI flags, SDK/sysroot and dependency inputs,
  patches and commands. Record those extra toolchain details in the build object
  alongside the schema's required fields.
- Application object/static-library files needed to relink, including generated
  code and a link response (`.rsp` or `.response`), in a regular-only
  `objects/` archive. `objectInventory` must enumerate all regular archive entries.
- Actual log demonstrating the retained objects can relink against the selected
  modified library and rebuild the final application. Include invocation, inputs,
  output hashes and smoke result. A nonempty placeholder is not verification.

With the rebuilt runtime, rebuild the exact Factory source using its frozen lockfile
and native target recipe. The maintained command is:

```sh
bun run scripts/build-binary.ts --source-root SOURCE --candidate candidate.json \
  --release-version EXACT_FROZEN_VERSION --target TARGET --output EMPTY_DIRECTORY
```

Use the supplied exact candidate's `recipe.versionOverride`; do not edit tracked
package versions. Preserve runtime selection and byte hashes for the recreated
Bun runtime. Rebuilding from source is not proof that object material relinks the
original distributed executable. The reviewer must establish that correspondence.

## Schema 2 assembly and intake

`source-materials.json` must have `schemaVersion: 2`, the exact `commit`, `version`,
`workflowSha`, `candidateDigest`, `bunVersion: "1.4.2"`, `records`, `patches`, and
`builds`. Missing input prevents assembly; there is no preparation-as-complete flag.

Each record contains `kind`, safe flat `file`, HTTPS `source`, exact `revision`,
`sha256`, positive `size`, and a `target` for native materials. Required singletons
are `bun`, `webkit`, `tinycc` (named `<kind>-source.tar.gz`, using the immutable
codeload URLs or exact official Git commit/tree URL for a reviewed Git archive), `runtime-license`, `tinycc-patch`, and `instructions` (`README.md`).
For each native target, require exactly one `objects`, `build-config`, and
`relink-log`. Native records use the candidate's source commit as `revision`.
Additional materials are allowed and remain subject to full-payload review.
`patches` enumerates record filenames, including the pinned TinyCC patch.

Each build object contains `target`, `commit`, `version`, `candidateDigest`,
`bunRevision`, `webkitRevision`, `tinyccRevision`, `runtimeSha256`,
`executableSha256`, `compiler: {name, version}`, nonempty `nativeFlags` and
`commands`, and `objectInventory`. Its `build-config` record must contain that
same JSON object. Semantic checks cannot authenticate a claimed compiler, hash or
log; the independent review must compare them to real native outputs and executions.

Once those inputs exist and are reviewed:

```sh
node scripts/build-release-source.mjs --sha FULL_FROZEN_SOURCE_SHA \
  --candidate /absolute/candidate.json --materials /absolute/reviewed-inputs \
  --output /absolute/new-empty-source-output
```

Assembly includes exact Git archives for Factory and frozen release tooling,
lockfile, candidate, instructions and all records. It adds a hashed `bundled`
inventory for its generated files and writes `source-record.json`. Evidence intake
now validates schema, candidate, pinned revisions, source markers, license/patch
bytes, all target inputs, object archive inventory and every recorded hash/size;
for frozen candidates it rejects schema 1 or inventory-only substitutes. It never executes submitted
instructions or logs. Existing historical archives and receipts stay byte-for-byte
unchanged; newly prepared releases must use the stricter material intake. Legacy schema-1 beta additive authentication retains its existing inventory and
independent licensing-receipt checks; it does not invent a replacement candidate
or rewrite historical source/evidence bytes.

## Archive intake limits

The intake reader streams gzip and parses USTAR, PAX and GNU long-name/link headers
without invoking `tar` on submitted archives. Header checks bound size before a
member is written or captured. Expanded-byte limits apply to actual decompressor
output, including padding and concatenated gzip streams; another tar hidden after
the end marker is rejected. Unknown source bundle members never reach disk.

The fixed default policy in `scripts/lib/bounded-archive.mjs` permits 8 GiB of
compressed input, 4 GiB per member, 16 GiB expanded per archive pass and 500,000
headers (including extension headers). Flat outer source bundles have a tighter
256-header cap. Candidate/material manifests and captured upstream license/build
scripts are limited to 1 MiB each, with an 8 MiB aggregate capture budget including
extension headers. Direct material manifests bound instructions/licenses/patches
and native build configurations to 1 MiB, relink text logs to 16 MiB, and total
recorded file bytes to 16 GiB. Inventory records must bind the exact positive size
and SHA-256; declared sizes do not substitute for streaming enforcement.

Each pass runs in a single owned Node worker with a 120-second deadline. The worker
creates no descendants; timeout kills that process, closes its descriptors and
lets the caller remove its private staging directory. Stream buffers are 64 KiB,
with at most one output chunk of expanded-byte overshoot before rejection. Listing
responses are capped at 128 MiB. Nested runtime/object archives are inspected,
never extracted; their decompression has the same byte/header/time limits. These
are per-pass limits; validation uses a finite set of outer and nested passes.

The checked-in policy accommodates the retained 64,602,344-byte Bun and
1,036,641-byte TinyCC inputs: actual reader checks observed 213,862,400 and
4,976,640 expanded bytes respectively. No size or passing intake is claimed for
unassembled WebKit/native objects. Before increasing a cap for a legitimate
larger input, review its pinned size/hash, expected expansion, member inventory
and host budget. Trusted callers can supply `{limits: {...}}` to
`validateSourceArchive`, `validateSourceMaterials`, `extractEvidenceArchive` or
`inspectArchive`; submitted manifests cannot raise limits. Public release intake
uses the fixed defaults.

Outer bundles are regular-only. Nested source links are resolved component by
component using the archive's link map: intermediate links expand before `..`
traversal, every step must remain inside the source root, and cycles/excessive
chains fail after at most 40 expansions. Legitimate framework
`Versions/Current` chains remain valid. A structural pass is not proof of upstream
source completeness, native byte correspondence or legal acceptance.

Member names are validated after PAX/GNU overrides and before control collection,
duplicate detection or legacy matching. Repeated separators, interior `.`/`..`,
absolute paths, backslashes, invalid UTF-8, controls and Unicode default-ignorable
marks fail closed. Names have at most 4096 decomposed UTF-8 bytes and 255 per
component. Directory names have one canonical trailing slash; regular/link names
have none. One exact leading `./` is removed, and the GNU tar `./` directory record
is ignored. No second `./` or other dot component is accepted. Thus GNU-prefixed
controls use the same identity as unprefixed controls, including legacy checks.

Intake applies one conservative portable policy on both macOS and Linux; passing
on a case-sensitive host does not exempt an archive from macOS alias checks. A
virtual tree includes implicit directory prefixes and rejects differently spelled
members with the same Unicode NFD/caseless key, directory/file/link collisions,
and differently spelled link references to an existing component. Caseless keys
use Unicode lower/upper/lower mappings, including multi-character mappings; the
policy deliberately rejects some distinctions a particular filesystem preserves.
Collected controls also reserve their exact spelling, including forbidden new
candidate/tooling controls at the legacy boundary. Exact Unicode filenames and
link targets remain supported; this is not an ASCII-only comparison or a probe
of the validation host's filesystem. Hardlinks remain unsupported. Link-containing
paths cannot traverse regular files, and no member can be placed beneath an
archived link. Exact framework chains remain accepted.

The actual retained Bun and TinyCC archives pass this portable policy, including
Bun's Unicode fixtures and nine symlinks, without changing their bytes or hashes.
A future upstream archive with colliding names requires an explicit reviewed
material/target policy and freshly bound hashes before intake; there is no silent
Linux-only bypass. This does not establish compatibility for arbitrary filesystem
comparison rules outside the supported macOS/Linux scope.

A digestless historical-beta identity rejects `candidateDigest`/`workflowSha`
claims in manifests, evidence, native archives/builds/receipts and source material,
even if those fields are malformed or null. New source schemas and frozen
candidate/tooling inputs also cannot enter through that legacy path. Genuine
historical material remains accepted with its original inventory and receipt
bytes; additive authentication still requires protected signing and exact
inventory approval. Do not delete contradictory metadata to force acceptance.

The operator still reviews the entire frozen payload: all runtime dependencies,
required notices/source/rebuild inputs, generated or modified code, actual object
relink correspondence, and desktop installer/update archives. The shell owner
handles Electron 44.7 notices and package inclusion; no automatic entire-Chromium
source requirement is asserted. Only an actual candidate-matched receipt satisfies
`licensingAndSource`. Authentic publisher pins/protected signing, rollout approval,
full-payload native/F1 evidence and GitGuardian reviews 38083768/38084076 remain
separate gates. This preparation changes none of them.
