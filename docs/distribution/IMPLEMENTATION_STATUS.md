# Ticket 38 implementation checkpoint

Implementation is **completed**, subject to the recorded validation scope below.
Work is preserved in the factory worktree; no commit, push, PR, release, stable-tag
change or merge was performed. Base: `03eb236570295fd047084b98a9a5a28851db4f9d`.
All local archives are dirty development candidates, not immutable release evidence.

## Latest human decisions and remaining validation limits

The fifth answer round authorized smoke testing only the targets available locally
and waived authenticated Cursor testing. It also required excluding potentially
problematic proprietary redistribution. No additional human decision remains.

- Current archives contain no Cursor SDK, modified SDK chunks, native Cursor
  programs or SDK dependency sidecars. The factory-owned IPC adapter loads an
  unmodified user-prepared SDK 1.0.19 using that installation's Node >=22.13.
  Preparation is documented in the distribution guide. Native IDs, MCP options,
  stream ordering, usage, cancellation and disposal have process-boundary regression
  coverage. Packaged Bun-to-Node IPC create/resume was tested with a synthetic SDK,
  not a real authenticated Cursor account.
- All four final development archives cross-built. Native Darwin ARM64 and Linux
  ARM64 installation/runtime smoke passed after the final queue/schema fix and
  Cursor packaging change. Intel macOS and Linux x64 native execution remain
  unverified by the human's accepted scope. The configured CI matrix has not run
  remotely. No minimum OS/libc/CPU compatibility is established here.
- Publication remains a later pipeline responsibility. Verify immutable candidate
  provenance and the selected Bun runtime's exact source/rebuild material and
  notices before distributing it. This role did not produce or publish a release.

## Accepted security exception

The fourth answer round explicitly authorized continued implementation despite
existing high warnings for node-forge (`GHSA-86w9-cpqp-85rv`) and braces
(`GHSA-vfj7-8cjw-p6xm`). The latest audit still reports those two warnings.
Earlier natural resolution removed proxy-addr and source-map-js warnings.
No zero-warning audit result or blanket future security exception is claimed.

## Implemented work

- Maintained product/package/env/home/tool/hook identities, private owned packages,
  independent binary setup, prepared-tool discovery, embedded resources and scoped
  internal MCP dispatch. Host Git helpers, wrappers and credential stores remain
  intact; token updates no longer install global Git helpers or run authentication.
- Four-target pinned Bun builder, external user-prepared Cursor SDK host,
  executable permission hook, checksum/provenance installer, safe manual replacement
  and build-only CI. Installer rejects traversal, duplicate members and links before
  prefix mutation. Aggregate notices retain source/license provenance. Publication
  still requires exact runtime source/rebuild material and native dependency/license
  completeness. Cursor's proprietary SDK/native components are excluded.
- Migration discovery, redacted preview, verified private backups, structured
  path/env/tool changes, stock-plugin relocation, real Git worktree backlink repair,
  native transcript preservation and provider continuation evidence checks. Service
  backup/restore paths are explicit; read-only snapshots are not restored over new
  host conversations. Restore retains destination/native/external recovery copies.
- Source/destination aliases are resolved for inspection and consumer detection.
  Coordinator validation shares the runtime schema; malformed queues and live
  execution fail before mutation. Operational queue identities relocate their home
  or nested factory path, including aliases, while queue order and IDs survive.
  The migration guide requires the manifest's exact canonical home at cutover.
- Migration/setup guidance, product contracts, self-describing installation prompts,
  website instructions and changelog updates; historical evidence and upstream
  attribution retained. Automatic updates and Windows remain deferred.

## Validation receipts

- Latest root `pnpm build` and `pnpm typecheck`: passed.
- Latest CLI tests: 119 passed across nine files. Latest whole-package verification:
  2,420 passed, two skipped, including capacity, migration dependencies, Cursor
  (48 tests) and external HTTP transport conformance. The broad run caught invalid
  Unicode/spaces in renamed HTTP headers; upstream ASCII wire names were restored
  and the suite passed. Those external contracts are recorded in PRODUCT_CONTRACTS.
- Latest Biome CI: no errors, 27 warnings and seven informational findings.
- Website typecheck/build and headless desktop/mobile inspection passed earlier.
  Latest packaged-dashboard headless desktop/mobile screenshots were inspected and
  retained in the evidence directory. No new UI change was made on this visit.
- Four development targets built. Actual native Darwin ARM64 (macOS 26.6.2) and
  Linux ARM64 (Debian bookworm, glibc 2.36 under native ARM64 Docker) passed isolated
  installation, version/help, missing-Cursor guidance, permission hook, assets/API,
  factory-context MCP, shutdown and restart without factory Node/Bun/npm on PATH.
  These tested versions are observations, not claimed minimums.
- Native prepared Codex F1 execution and same-session token continuation passed
  in checkout and compiled executable. A migrated waiting workflow completed after
  answering through fresh MCP context; its earlier completed receipt executed once.
  Restore retained the new completed destination and restored original Git backlinks.
- A real coordinator created two parked queued requests. Migration retained them;
  a relocated coordinator reattached them in reverse order and executed them in the
  original order. Recovery passed. An unapproved review fixture retained the exact
  revision, waiting checkpoint, empty decisions and ticket receipts.
- Packaged prepared Claude launched and returned a native authentication failure
  under the isolated test account. Host authentication exists, but starting a worker
  with the host account correctly refused its live legacy coordinator. The operator
  worker was not stopped and the barrier was not bypassed. Gemini CLI is absent;
  authenticated all-provider behavior is not claimed.

An earlier waiting fixture prohibited MCP access and was abandoned. A subsequent
older candidate reported tools unavailable; the latest candidate completed the same
fixture after retry. Its cause was not isolated, so that attempt is not a passing
receipt. Direct app-server probes confirmed the current packaged MCP connection;
no speculative Codex readiness change was made.

Supplied ticket-sync receipts report delivery and `in_progress`; no synchronization
gap was recorded. This snapshot does not establish the tracker's current live state.
Evidence: `/Users/jappy/.cyrus/factory/evidence/manual-7f0c7c6e-cca1-4387-b7ee-7d81e06997ba`.
Final candidate archives: `/tmp/factory38-accepted-artifacts`; isolated installed
Mac prefix: `/tmp/factory38-accepted-prefix`. All four checksum/size manifests were
verified, and archive listings/notices exclude Cursor SDK and node_modules sidecars.
Earlier archives containing Cursor files are superseded development experiments,
not delivery candidates. Test state/backups under `/tmp` remain for inspection. Test workers were stopped;
operator state, services and native credential stores were not migrated.
