# Video and Codex startup recovery integration

**Date:** 2026-10-07  
**PR:** [#33](https://github.com/Attraccess/bobs-factory/pull/33)  
**Previous head:** `a421c4915e0c8946d4726d3021ff3e0048493c65`  
**Integrated base:** `0de51ccffc335155b0d1ebaca66c6c171f73f74e`  
**Runtime source fingerprint:** `6aaf654a7fddbd494d77b370c5e95c85c9ed22b814e8c73db7e0a7a238694d3b`

The only manual merge conflict was in CHANGELOG.md. Both the video caption
fix and the base's Codex startup recovery entry were preserved. The runtime
merge retains video startup cleanup alongside Codex checkpoint recovery.

## Applicable scenarios and results

The base changes runner lifecycle and persisted retry. An embedded F1
EdgeWorker used a disposable repository/home and a controlled Codex backend.
Every agent was intercepted; `F1_AGENT_MODE=mock` was required. No native
provider process, provider credits or production ticket mutation was used.

Three issue/session flows passed through startup failure, worker restart and
the protected HTTP Retry endpoint. Fresh startup failures saved no invented
thread. Proven legacy startup IDs were removed after the missing-thread
failure. Established conversations retained their thread on retry. Completed
clarification and QA scope ran only once and their exact receipts survived.
The combined qa-v1/video-v1 capture and gate completed for all three flows;
backend-only scope retained its explicit no-recording reason. Activity output
was readable and all owned workers stopped with zero active/queued slots.

A separate simulated-agent replay validated the previously recorded real Save
clip through current runtime validation. Four linked scenario changes rejected
reuse; an unrelated story permitted reuse and passed the real video gate.
Startup cleanup removed 200 assets, then the remaining six on its next pass,
including historical capture assets. History and metadata survived; expired
media returned HTTP 410. This was historical media replay, not a fresh
recording or new playback inspection.

## Commands and evidence

```sh
F1_AGENT_MODE=mock pnpm --filter cyrus-edge-worker exec vitest run test/WorkflowRuntime.test.ts test/Video.test.ts test/EdgeWorker.capture-recovery.test.ts test/AgentSessionManager.codex-runner-activity.test.ts test/FactoryServer.test.ts
F1_AGENT_MODE=mock pnpm --filter cyrus-codex-runner test:run
pnpm build
F1_AGENT_MODE=mock bun run <evidence>/ci-startup-integration-f1.ts
F1_AGENT_MODE=mock bun run <evidence>/ci-startup-integration-video-drive.ts
```

All 151 affected edge-worker tests and 84 Codex tests passed. Build passed.
Evidence and scripts are retained under
`/Users/jappy/.cyrus/factory/evidence/manual-30032642-7584-4d54-9ff6-0baa919d6148`:
`ci-startup-integration-tests.log`, `ci-startup-integration-codex-tests.log`,
`ci-startup-integration-build.log`, `ci-startup-integration-f1.log`,
`ci-startup-integration-runtime/`, `ci-startup-integration-video.log` and
`ci-startup-integration-receipt.json`.

## Limits

These checks establish deterministic orchestration, adapter failure handling,
persistence and video regression behavior. Native Safari/iOS playback,
real-agent wording and live production ticket synchronization remain
unverified. Earlier recording/playback evidence and all four resolved review
findings remain historical context. Current-revision review and explicit
human approval remain separate; the PR stays draft.
