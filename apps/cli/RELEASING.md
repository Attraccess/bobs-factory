# Bob’s Factory release candidates

Workspace packages are private. Upstream npm publication is retired. The old
operator tooling is preserved under `scripts/archive` for historical context,
not supported fork publishing. Build the candidate using
[the binary contract and validation procedure](../../docs/distribution/README.md).

The `binary-build.yml` workflow accepts a full immutable reviewed candidate SHA
and exact committed version. All four native-target jobs must pass. It only
builds, validates and uploads CI artifacts; it never publishes or moves a tag.
The implementation role does not create a release, PR or mark a PR ready.

The separate `binary-release.yml` publisher verifies every manifest checksum, archive inventory,
license notice and native runtime receipt, plus prepared-agent/native-helper
coverage. Preserve the reviewed SHA and immutable version; do not rebuild a
reviewed candidate from a mutable branch. Verify the entire runtime payload under
the canonical F1 policy before a release. Retain backups and the prior executable
for manual rollback. Automatic updates are separate work.

The first beta requires final-candidate four-target native validation, current
authenticated prepared-agent evidence or an explicit scoped human waiver, reviewed
full-payload F1 coverage, migration preservation and complete runtime source/relink
material. Cursor is user-prepared and excluded from distributed archives. Scripted
protocol checks do not satisfy authenticated-agent validation. Minimum macOS/libc
support must be backed by native execution evidence before publication. See
[the public release procedure](../../docs/distribution/PUBLIC_RELEASES.md) and
[the full-payload assessment](../../docs/distribution/RELEASE_F1_ASSESSMENT.md).
