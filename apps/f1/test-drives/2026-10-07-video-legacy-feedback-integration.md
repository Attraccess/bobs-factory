# Video and legacy feedback recovery integration

Date: 2026-10-07. Tested merge working tree at video head `79c0b9be`
with fetched main `ec130ae0`. Runtime/test diff SHA-256 against main:
`6d26cd478a2d48b15d4dc368aafc159c72ef544365c81e1156d6eb5fed8e40b9`.

## Scope and setup

Main adds legacy feedback-context recovery alongside the video branch's
validation and finalization. The only manual conflict was CHANGELOG.md;
both user-facing entries were retained. F1 applies to the combined runtime.
No new feature behavior was introduced during resolution.

Evidence and driver copies:
`/Users/jappy/.cyrus/factory/evidence/manual-30032642-7584-4d54-9ff6-0baa919d6148/ci-legacy-integration`.
The inherited legacy driver was redirected to this worktree's built modules.
Both drivers ran sequentially with `F1_AGENT_MODE=mock`. Legacy recovery used
an isolated home/repository and deterministic MockAgentRunner for every role,
scripted provider reads, disabled title generation and no provider mutations.

## Executed assertions

- Legacy restricted-input CI fix reconstructed the exact pending comment ID,
  body and content hash, assessed it once and returned directly to readiness.
  It retained one code-review visit and the human approval blocker.
- An assistance wait survived worker shutdown and restart after its persisted
  readiness receipts were downgraded to the legacy shape. Answering resumed
  the existing correction with the exact pending content, with two total fixer
  visits and one review. Both scenarios retained response activities and zero
  agent cost. Capacity ended empty and the worker released its ports.
- The video runtime replay rejected changes to each of four linked scenario
  definitions, while allowing unrelated-story reuse through the actual gate.
  It expired current and historical assets across startup cleanup passes:
  200 deleted first, then six remaining. Metadata/history remained; expired
  playback returned HTTP 410. It replayed a historical authentic recording,
  without claiming fresh browser recording or playback inspection.

Commands: `bun run ci-legacy-integration/legacy-feedback-drive.ts` and
`bun run ci-legacy-integration/video-replay-drive.ts` from the evidence directory
(with the mock environment and absolute driver paths).
Receipts: `legacy-f1.log`, `receipts.json`, `contexts.json`,
`legacy-checkpoint.json`, `video-replay.log`, `video-replay-receipt.json`.

## Other checks and limitations

Ten focused edge-worker suites passed: 255 tests covering video, workflow,
server, feedback policy, readiness, review recovery and EdgeWorker recovery,
persistence and triggers. `pnpm build` passed. Commit hooks additionally
require build, typecheck and staged-file formatting.

This is mocked workflow and recorded-media replay evidence. It does not
establish native agent behavior, fresh browser playback, Safari/iOS or the
unavailable Playwright fallback. Historical browser evidence remains intact.
Production ticket synchronization was not independently rechecked. No approval,
ready transition or merge was performed; PR #33 remains draft.
