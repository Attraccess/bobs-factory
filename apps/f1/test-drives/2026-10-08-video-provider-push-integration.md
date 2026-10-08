# Video evidence integration with Git providers and Web Push

**Date:** 2026-10-08
**PR:** [#33](https://github.com/Attraccess/bobs-factory/pull/33)
**Candidate:** `0e9a2215` plus the merge of `origin/main` at `88468857`.

The base introduced Git provider selection, opt-in Web Push and Codex worktree
permissions. Changelog conflicts retain both features. The capability reference
and complete routing prompt fixture retain video, provider and notification
guidance. Video finalization, authenticated media routes and startup cleanup
remain intact after automatic merges.

## Applicable scenarios and results

All agents used `F1_AGENT_MODE=mock`, injected runners or scripted responses.
Existing authentic media was replayed; this drive does not claim a new recording.

- The local issue-tracker fixture created an issue and retained its identity.
  Actual runtime capture and video gates accepted unchanged evidence, rejected
  four linked scenario mutations, and accepted unrelated-story reuse.
- Scripted GitLab readiness used only `glab` calls. Successful checks at the
  fixture head allowed review but retained draft status and required reviewer
  approval. The accepted provider survived persisted video recovery.
- Missing and changed execution credentials blocked recovery without losing
  video assets, answers, history or the existing conversation. Restoring the
  fixture binding resumed the same conversation without rerunning capture.
- Persisted startup cleanup removed 200 expired assets on its first pass and
  the remaining six on its second. Historical evidence metadata survived;
  expired playback returned HTTP 410.
- An embedded EdgeWorker used real F1 issue creation, assignment, worktrees,
  HTTP answer submission and timeline output. Four correction, stalled-review,
  code-change and visual-review scenarios passed with simulated agents.
  Restart retained pending questions and video hashes; changed code invalidated
  the clip. Answers did not create human approval. Shutdown left no active or
  queued fixture execution.
- Headless Chromium at 390 × 844 loaded the authenticated review guide.
  Lazy activation, native controls, `preload=none`, playback, seeking and an
  expanded transcript passed without horizontal overflow. The screenshot was
  opened and inspected; normal scrolling keeps the controls reachable.

## Commands and evidence

Temporary drivers live in `node_modules/.cache/ci-provider-video/`:

```sh
F1_AGENT_MODE=mock bun node_modules/.cache/ci-provider-video/replay.ts
F1_AGENT_MODE=mock bun node_modules/.cache/ci-provider-video/integration.ts
python3 node_modules/.cache/ci-provider-video/browser.py
pnpm build
pnpm audit
```

The embedded worker and browser server unset inherited public-origin and binary
launch settings and use an isolated migration-capacity directory. The browser
server used port 3690 and the fresh headless session `ci31-provider-20261008`.
Authentication used a synthetic session only in the disposable fixture home.

Application tests passed 302, guide tests passed six, and targeted Codex backend,
Git-metadata and sandbox tests passed 46. Eight context tests and Biome CI also
passed. Frozen installation, build and the
dependency audit passed. Required build and type checks also run in the commit
hook. Logs use the `node_modules/.cache/ci-video-provider-` prefix.

Evidence is under the run evidence directory with the `ci-provider-video-`
prefix: integrated replay, execution recovery, EdgeWorker recovery, browser
actions, browser receipt and mobile screenshot. Test setup initially reused a
capacity directory and authentication origins from an older fixture; isolated
settings corrected them. A missing reload after seeding authentication and an
incorrect copied-media path were corrected before the passing executions.

## Limits

This establishes simulated-agent orchestration and real headless playback.
Live GitLab APIs, real-model wording, native startup causes, physical passkey
enrollment, physical-device Web Push and native Safari/iOS remain unverified.
Live ticket synchronization remains runtime-owned and independently unverified;
delivered receipts coexist with a backlog snapshot. Explicit human review is
still required. No production tracker, credential store, remote forge fixture
or user browser was changed.

The inherited `http_ece` license has a trailing blank line flagged by
`git diff --check`; its verified upstream bytes and pinned hash are preserved.
The remaining integration diff passes the whitespace check.
