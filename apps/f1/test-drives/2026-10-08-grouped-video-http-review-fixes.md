# Grouped video HTTP and provider review fixes

Date: 2026-10-08. Base revision: `78613ffa68175e122d0dfa0a936712f3c4555abb` plus the fixes in this commit.
Runtime diff SHA-256: `344b33ba209250c45bed305df5d7bc2fe7ea98e8fcd571e796b4ed43ced5d2d8`.

Grouped recordings now stream from each retained Git worktree beneath a non-Git
parent. GitLab diff and file links use the supported MR routes and file selector;
GitHub keeps its existing file destinations. These changes require relevant F1
validation of grouped routing, retained provenance and authenticated media access.

## Executed checks

- `F1_AGENT_MODE=mock bun node_modules/.cache/video-fix17/f1.ts` passed. The adapted
  retained grouped-video drive creates a CLI ticket, routes its shared labels into
  three real worktrees, and executes extraction and six specialists with simulated
  agents. Scripted forge responses publish only the two changed fixture repositories.
  Full GET, HEAD and range requests return exact recorded media and poster bytes.
  A secondary source edit blocks HTTP playback, gate acceptance and reuse. The full
  delivery decision remains pending with no human approval or merge submission.
- `pnpm --filter bobs-factory-edge-worker test:run test/Video.test.ts
  test/FactoryReviewContext.test.ts test/ReviewFiles.test.ts test/FactoryAccess.test.ts`
  passed all 38 tests, including grouped clean/dirty/committed/missing-worktree HTTP
  regression coverage, all asset types, malformed metadata and both forge destinations.
- Edge-worker build (including both TypeScript configurations), Biome and diff checks passed.
- Real headless Chromium used the actual FactoryServer and rebuilt UI. All 18
  authenticated full/HEAD/range requests matched recorded media/poster/caption
  bytes. Playback advanced, seeking reached 2 seconds, captions loaded, and a
  returned lazy player remained playable. Chapter and Changed files links used the
  owning delivery for identical filenames. The mounted comment draft survived file
  navigation and reopening; the two-delivery decision remained pending. At 390px,
  native controls were usable with no horizontal page overflow. GitLab Decide used
  `/diffs`. GitLab file URLs match its official route, SHA-1 filename selection and
  `diff-content` ID conventions.

## Evidence and limits

Receipts and inspected replacement screenshots are in
`/Users/jappy/.cyrus/factory/evidence/manual-30032642-7584-4d54-9ff6-0baa919d6148`: `fix17-validation.json`, `fix17-browser-results.json`,
`fix17-f1-results.json`, `fix17-tests.log`, `fix17-build.log`,
`fix17-grouped-decide.png` and `fix17-provider-decide.png`.
Drivers remain in `node_modules/.cache/video-fix17` in this worktree.

The first F1 attempt had mismatched fixture RPC ports; the corrected execution
passed. Browser-driver corrections closed the comment popover before navigating,
used supported CLI selectors and centered file rows clear of the existing sticky
footer. Original failures and successful replacement receipts are retained.

The recording is a historical authentic non-sensitive fixture replay, not a newly
recorded feature demonstration. Agents and forge responses were simulated; browser,
HTTP, Git and media validation were real. No provider credits or production forge
mutations were used. Owned browser/server resources were stopped. Native Safari/iOS,
physical passkeys, live GitLab loading, real-model reasoning, physical push delivery,
production proxy diagnosis and live ticket synchronization remain unverified.
PR #33 remains draft; this report grants no human approval.

GitLab source evidence: [routes](https://gitlab.com/gitlab-org/gitlab/-/raw/master/config/routes/merge_requests.rb),
[filename hash](https://gitlab.com/gitlab-org/gitlab/-/raw/master/lib/gitlab/diff/file.rb),
[file URL](https://gitlab.com/gitlab-org/gitlab/-/raw/master/app/assets/javascripts/diffs/components/diff_row_utils.js).
