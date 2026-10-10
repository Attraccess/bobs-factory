# Resume a first chat turn interrupted during its startup save

**Date:** 2026-10-10  
**Tested code revision:** `320cc5b7daf047398d1c462c53aeb46af02215bd`  
**Mode:** simulated agents (`F1_AGENT_MODE=mock`)

Disabling Simple during a first chat turn's startup save now preserves a recoverable never-started turn. After restart, individual Resume starts that turn with its original prompt and model. This addresses all four startup-checkpoint findings on [PR #83](https://github.com/jappyjan/bobs-factory/pull/83).

## Results

- All **96 tests in eight focused suites passed**. Coverage includes production chat wiring, continuation, concurrency, native recovery, chat state, machine capacity, capacity integration and pending-work admission.
- The [checkpoint-cancellation receipt](assets/chat-checkpoint-fix/checkpoint-cancel-chat-receipt.json) covers Slack and Zulip. The fixture delays completion of a successful startup save, disables Simple and confirms zero provider starts. After cancellation settles, it reads the actual saved worker state from disk and reconstructs the handler from that state. The never-started marker is false, the saved input is exact and the recovery block remains. Enabling and automatic recovery do not continue the turn. Protected individual Resume returns **202**, delivers the original prompt once with **accepted-initial-chat-model** despite changed defaults, posts the saved reply, completes and clears the block. Capacity is released.
- The [capacity-queue receipt](assets/chat-checkpoint-fix/queued-first-chat-receipt.json) retains the earlier passing Slack/Zulip behavior before capacity admission.
- The [established-chat missing-ID receipt](assets/chat-checkpoint-fix/qa-production-missing-thread-receipt.json) records **HTTP 409**, zero new runners and exact preserved recovery state. Restoring the original ID permits [normal Resume](assets/chat-checkpoint-fix/qa-chat-model-complete-receipt.json) with the original conversation and accepted model. The [catalog receipt](assets/chat-checkpoint-fix/established-catalog-receipt.json) retains passing migration, dependency admission, saved-runtime and operator recovery checks.
- Streaming and nonstreaming concurrency tests confirm cleanup finishes before the start promise settles and capacity is released. Post-save admission rejection also restores the checkpoint. Provider startup failure never restores it, because provider effects are uncertain. Slack/Zulip production-wiring tests confirm a failed cleanup save retains the started marker and rejects missing-ID Resume after restart.
- Workspace build and type checks passed through the commit hook. Workspace lint passed with **19 existing warnings**. Changed TypeScript files passed focused lint. `git diff --check` passed.

## Reproduction and evidence

The [validation receipt](assets/chat-checkpoint-fix/validation.json) records the tested code revision, source and fixture digests, raw receipt locations and check logs. The committed receipts omit disposable capacity lease/process identities; raw receipts remain in the evidence directory.

```sh
python3 /Users/jappy/.cyrus/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/chat-native-thread-fix/qa-clean-run.py pnpm --filter bobs-factory-edge-worker exec vitest run test/ChatSessionHandler.model-recovery.test.ts test/ChatSessionHandler.continuation.test.ts test/RunnerConcurrency.test.ts test/WorkflowNativeRecovery.test.ts test/SessionChat.test.ts test/MachineCapacity.test.ts test/IntegrationCapacity.test.ts test/WorkflowPendingWorkAdmission.test.ts --maxWorkers=1
F1_AGENT_MODE=mock F1_RECEIPT_PATH=/Users/jappy/.cyrus/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/chat-checkpoint-fix/checkpoint-cancel-chat-receipt.json python3 /Users/jappy/.cyrus/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/chat-native-thread-fix/qa-clean-run.py bun run /Users/jappy/.cyrus/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/chat-checkpoint-fix/checkpoint-cancel-chat-f1.ts
F1_AGENT_MODE=mock F1_RECEIPT_PATH=/Users/jappy/.cyrus/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/chat-checkpoint-fix/queued-first-chat-receipt.json python3 /Users/jappy/.cyrus/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/chat-native-thread-fix/qa-clean-run.py bun run /Users/jappy/.cyrus/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/chat-checkpoint-fix/queued-first-chat-f1.ts
F1_AGENT_MODE=mock F1_RECEIPT_PATH=/Users/jappy/.cyrus/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/chat-checkpoint-fix/established-catalog-receipt.json python3 /Users/jappy/.cyrus/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/chat-native-thread-fix/qa-clean-run.py bun run /Users/jappy/.cyrus/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/chat-checkpoint-fix/established-chat-f1.ts
pnpm lint
```

The handler, production configuration/runner factory, persistent capacity, transactional storage, workflow catalog and protected recovery API execute normally. Provider execution, transports and title jobs are simulated. The checkpoint fixture controls only the completion timing of a real successful storage write. All three drives stopped their listeners and removed disposable homes and repositories.

Real agents and live Slack/Zulip remain untested. A crash after the durable checkpoint, uncertain provider effects, or failed cleanup persistence retains conservative recovery errors. Older saved chats without startup history still require a saved conversation ID. UI code is unchanged; prior accepted visual evidence remains applicable. External ticket synchronization remains unconfirmed. Reviewer reassessment and later gates remain required; the PR remains draft and unmerged.
