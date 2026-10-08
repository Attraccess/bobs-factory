# Video and feedback recovery base integration

Date: 2026-10-07. Tested clean product HEAD
`d1c378380160bf958169b56b9907137228f7c44b` plus the resolved merge of
`ce61ddb6386440e5bbdcbd102890509e81b5d35f`.
Edge-worker source/test diff SHA-256:
`b1811ca6c5f1a4f318f1e1743d1a7db84eb449ab2902720e06d2dd107ff32228`.
Factory web build: `749d3f4a23525902af0ea133`, unchanged from the preceding revision.

## Applicability and scenarios

The newer base introduces feedback assessment and code/visual review recovery
beside video finalization. F1 applies to their integrated runtime behavior.
Resolved the EdgeWorker conflict by retaining guide/video validation and capture
finalization, with feedback assessment in the base's output-validation path and
review-fix provenance after finalization. Stock workflows retain both video
contracts and recovery instructions. Both changelog histories are preserved.

Adapted the inspected existing recovery drivers to import this worktree's built
EdgeWorker, with isolated homes/repositories and deterministic MockAgentRunner
injection. Provider receipts/comments were scripted; no production tracker,
GitHub mutation, native agent or inference API was used. Replayed the previous
video regression driver against current source with historical authentic media.

## Commands and results

```sh
pnpm typecheck
pnpm build
pnpm biome ci
F1_AGENT_MODE=mock pnpm --filter cyrus-edge-worker test:run test/Video.test.ts test/WorkflowRuntime.test.ts test/MergeReadiness.test.ts test/FeedbackPolicy.test.ts test/ReviewRecovery.test.ts test/EdgeWorker.capture-recovery.test.ts test/Questions.test.ts test/prompt-assembly.routing-context.test.ts
F1_AGENT_MODE=mock pnpm --filter cyrus-edge-worker test:run test/FactoryPipeline.test.ts test/Guide.test.ts test/FactoryServer.test.ts
F1_AGENT_MODE=mock bun <evidence>/ci-feedback-integration/factory-feedback-drive.ts
F1_AGENT_MODE=mock bun <evidence>/ci-feedback-integration/factory-review-recovery-drive.ts
F1_AGENT_MODE=mock bun <evidence>/ci-feedback-integration/video-replay-drive.ts
```

- All 247 targeted tests passed across 11 suites, including video contracts,
  captions, feedback assessment, review recovery, guide and server integration.
- Build and typecheck passed. Biome passed with the 29 existing warnings.
- Six feedback cases passed: explicit ignore, exact outstanding comment
  correction within the same role, no-progress/restart assistance, actual source
  correction with fresh review, policy reversal, and restricted recipe inputs.
- Four review cases passed: correction and restart, rejected unchanged attempt
  and assistance, actual source correction, and visual-fixer assistance. F1 CLI
  issue/session launches and response activities were verified. Both drivers
  ended with zero active/queued capacity and stopped their owned servers.
- Video replay rejected all four linked scenario changes, allowed unrelated-story
  reuse, passed the actual video gate, removed 200 expired assets then six remaining
  assets on the next startup, retained history/metadata, and returned HTTP 410
  for expired media. No new recording or playback inspection was performed.

## Evidence and limitations

Receipts, adapted drivers and command logs are retained at
`/Users/jappy/.cyrus/factory/evidence/manual-30032642-7584-4d54-9ff6-0baa919d6148/ci-feedback-integration`.
The recovery homes were `/tmp/factory-feedback-f1-A14gSj` and
`/tmp/factory-review-recovery-f1-see6KT`; their JSON receipts were copied into the
supplied evidence directory. The video replay receipt records its separate
throwaway fixture revision and home.

This is mocked orchestration and recorded-media replay evidence. Native Safari/iOS,
Playwright fallback and live ticket synchronization remain unverified. Prior
accepted screenshot and authentic recording evidence is preserved as historical
evidence. Human approval remains required; the PR remains draft.
