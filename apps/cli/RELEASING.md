# Bob’s Factory release candidates

Workspace packages are private. Upstream npm publication is retired. The old
operator tooling is preserved under `scripts/archive` for historical context,
not supported fork publishing. Build the candidate using
[the binary contract and validation procedure](../../docs/distribution/README.md).

The `release-channel.yml` workflow freezes eligible nightly source or an explicitly
selected complete signed published nightly's source for stable promotion.
`binary-build.yml` accepts that
frozen candidate JSON, including version override and separate reviewed tooling SHA. All four native-target jobs must pass. It only
builds, validates and uploads CI artifacts; it never publishes or moves a tag.
The implementation role does not create a release, PR or mark a PR ready.

The separate `binary-release.yml` publisher verifies every manifest checksum, archive inventory,
license notice and native runtime receipt, plus prepared-agent/native-helper
coverage. Preserve the reviewed SHA and immutable version; do not rebuild a
reviewed candidate from a mutable branch. Verify the entire runtime payload under
the canonical F1 policy before a release. Retain backups and the prior executable
for manual rollback. [Per-instance updates](../../docs/distribution/UPDATES.md)
and [desktop app updates](../../docs/distribution/DESKTOP.md) use separate owned
lifecycle mechanisms; this release procedure does not activate them.
Publication defaults to disabled; nightlies
require separate activation, signed manifests and complete evidence. Stable needs
protected approval bound to its frozen candidate and exact signed asset digest.
Use the retained prepared artifact to resume publication or retry only Pages
synchronization. Never rebuild or move a tag to recover publication.

Every release requires final-candidate four-target native validation, mocked
prepared-agent protocol evidence, reviewed full-payload F1 coverage, migration
preservation and complete runtime source/relink material. Use mocks for all release
agent tests. Live provider tests are manual-only and require explicit approval for
the specific test; they are not a release gate and need no recurring waiver.
Mock receipts must identify their controlled scope and never claim authenticated
provider execution. Cursor is user-prepared and excluded from distributed archives.
Minimum macOS/libc support must be backed by native execution evidence before
publication. See
[the public release procedure](../../docs/distribution/PUBLIC_RELEASES.md) and
[the full-payload assessment](../../docs/distribution/RELEASE_F1_ASSESSMENT.md).
