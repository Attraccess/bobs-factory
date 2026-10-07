# Video scenario reuse and retention review fixes

Date: 2026-10-07. Base revision: `cdb46a87c02bad21b40fbe32e34ec807ab347612`,
with the review fixes uncommitted. SHA-256 of the tested diff for `Video.ts`,
`Workflow.ts` and `Video.test.ts`:
`c22e25191ba25a47fe477fab7600fa7f973f6dff9e4c329fbd96d22eff443c60`.

## Scope and execution

These fixes change Factory runtime evidence reuse and startup maintenance, so
F1 applies. The drive injects deterministic mocked capture/review runners with
`F1_AGENT_MODE=mock`; no agent CLI/API calls or provider credits were used.
It uses real `WorkflowRuntime`, video finalization and gates, persisted restart
cleanup, and `FactoryServer` against an isolated Git repository. F1's in-memory
`CLIIssueTrackerService` created and fetched `issue-1`.

```sh
F1_AGENT_MODE=mock bun node_modules/.cache/factory-video-fix/drive.ts
```

Successful fixture home:
`/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/f1-video-review-fixes-kdg1U8`.
Isolated source revision: `ac25305432fcc7c275c40c443adb295a189a52a1`.

Capture replays the existing authentic Save-record clip from the original video
drive. Actual decoding, probing, hashes, filesystem operations and HTTP handling
run normally. Playback acceptance is a mocked historical receipt, not a fresh
human review or a new browser recording. The earlier report and demonstration
remain unchanged. No frontend rendering changed in these fixes.

## Assertions and results

- Mocked capture → review → real video gate completes and persists its history.
- Changing linked fixtures, preconditions, actions or expected criteria with the
  same task/story/criterion IDs and unchanged source files fails capture reuse.
  Every rejected attempt retains the previous capture output.
- Restoring the linked story and adding an unrelated story permits reuse and
  passes the real gate.
- Persisted terminal runs contain current and superseded capture rounds, plus
  101 additional expired runs with two assets and a missing caption each.
  Startup removes exactly 200 files on the first pass and the remaining six on
  the second, despite retained metadata and missing paths. Both historical and
  current video/poster pairs expire.
- Restart preserves complete serialized capture history and metadata. The
  loopback media route returns HTTP 410 for the expired recording.
- Four focused suites (`Video`, `FactoryPipeline`, `Guide`, `WorkflowRuntime`)
  pass all 123 tests. New regression tests failed against the pre-fix code;
  they additionally cover historical captions, duplicate history references,
  legacy task-only receipts and the deletion budget.
- Monorepo `pnpm build` and `pnpm typecheck`, changed-file Biome checks and
  `git diff --check` pass.

## Evidence and limitations

The run evidence directory contains `video-review-fix-drive.ts`,
`video-review-fix-results.json` and `video-review-fix-tests.log`. To replay,
copy the script to the documented cache path; it imports repository source and
uses the original drive's saved clip/poster in
`node_modules/.cache/factory-video-drive/home/factory/evidence/video-drive/`.
Fixture data remains outside source control.

This drive covers the changed reuse/retention paths. It does not repeat browser
capture, mobile playback, native Safari/iOS, Playwright fallback or production
ticket synchronization. Original native playback/fallback coverage gaps remain.
The driver performs no production tracker writes, human approval or merge.
