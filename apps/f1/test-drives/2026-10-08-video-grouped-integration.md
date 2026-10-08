# Feature video integration with grouped repositories and context recovery

Date: 2026-10-08. Delivery: [draft PR #33](https://github.com/Attraccess/bobs-factory/pull/33).

F1 applies to the integration of grouped workflow scope, recording provenance and
Codex startup/retry recovery. Tested merge worktree: parent `e828ff564c45d755de8b3ebcc1f5b9cb6c836678` plus main
`beb6ed76305946fcfab38fa978cb7e3b4e83f6dc` and the recording-source correction. Package diff SHA-256:
`a8aef780e06c38ea6782f9229bc28ef11f2c2ea94ccbbfe489104edaf5422ab9`. No production state or provider credits were used.

The recording validator previously ran Git in the grouped parent directory,
which is not a repository. Capture and playback gates now hash sources in every
retained repository. A focused regression checks successful validation and reuse,
then rejects playback acceptance and reuse after a secondary source changes.

## Executed checks

- Grouped F1: issue routing to three local worktrees, stock extraction and six
  specialist reviewers, two simulated forge deliveries, exact fixture approval,
  merge confirmation, manual/custom/nested, Takeover and Simple scope passed.
- Extended grouped F1: actual encoded historical recording bytes pass validation
  and unaffected reuse. Changing a secondary source blocks the recording gate
  and requires recapture. Restoring those bytes restores gate acceptance.
- Codex context F1: missing context before work and during correction, restart,
  preserved completed roles/native thread and repeated bounded Retry passed.
- Specialist/video F1: malformed inventory and stale guide references trigger
  corrections while preserving coverage and recorded media.
- Ten headless Chromium checks passed, including virtual passkey enrollment,
  guide playback, coverage/dispute rendering, comments, mobile layout and form
  navigation. No approval was submitted in this browser fixture.
- 221 distinct EdgeWorker tests and 129 Codex tests passed. Build, typecheck,
  Biome and diff checks passed.

Reproducible upstream drive: `F1_AGENT_MODE=mock bun
apps/f1/test-drives/assets/codex-context-readiness.ts`. The extended grouped drive,
original failed import-order attempt, passing retry logs, browser driver,
screenshots and source receipt remain in the run evidence directory under
`ci-grouped-video-integration`. The isolated driver initially imported Video
before EdgeWorker and encountered the existing schema cycle; using the normal
entry point fixed the fixture without changing product import behavior.

Agents, forge responses and playback acceptance receipts are simulated. The
separate browser checks execute actual protected access and playback. Historical
media replay does not claim a newly recorded demonstration. Native Safari/iOS,
real-agent reasoning, physical passkeys/push, live GitLab and ticket synchronization
remain unverified. Earlier human approval does not bind this new revision.
