# Resume a first chat turn interrupted before capacity admission

**Date:** 2026-10-10  
**Tested revision:** `ccc84e6bdd3faa7c27c3360840701f8b0f420ba9`  
**Mode:** simulated agents (`F1_AGENT_MODE=mock`)

Slack and Zulip chats disabled while their first turn waits for capacity now Resume after re-enabling, including after handler restart. They keep the accepted prompt, reply event, runner and model. Established chats still reject a missing saved native conversation ID. This addresses the three queued-first-chat findings on [PR #83](https://github.com/jappyjan/bobs-factory/pull/83).

## Results

- All **90 tests in eight focused suites passed**: production chat model/recovery wiring, chat continuation, runner concurrency, native recovery, chat state, machine capacity, capacity integration and pending-work admission.
- The [queued-first-turn F1 receipt](assets/chat-first-turn-fix/queued-first-chat-receipt.json) records initial Slack and Zulip turns behind an occupied capacity slot, zero provider starts and no native IDs. Disabling cancels their queued starts. Serialization and handler reconstruction retain the pending turn and the never-started marker. Neither enabling nor automatic recovery continues blocked work. Individual protected HTTP Resume returns **202**, delivers the original prompt once with **accepted-initial-chat-model** despite changed defaults, posts the saved reply, completes and clears the block. Capacity is released.
- The [established-chat missing-ID receipt](assets/chat-first-turn-fix/qa-production-missing-thread-receipt.json) records **HTTP 409**, zero new runners, and the exact retained block and pending turn. Restoring the ID permits [normal Resume](assets/chat-first-turn-fix/qa-chat-model-complete-receipt.json) with the original native conversation and accepted model. The reused observing fixture forwards the new startup checkpoint callback; provider execution remains simulated.
- The established-chat drive also retained passing ticket attachment/repository recovery, asynchronous admission, migration/dependency gating, manual Simple operator recovery and protected export/import checks. See its [catalog receipt](assets/chat-first-turn-fix/established-catalog-receipt.json). Both drives stopped listeners and removed disposable homes and repositories.
- Streaming and nonstreaming startup tests verify that cancellation during checkpoint persistence and a failed checkpoint start no provider and release capacity. The production factory records startup only after capacity admission, saves before provider side effects, and rechecks cancellation and workflow admission afterward.
- Workspace build and type checks passed through the commit hook. Workspace lint passed with 19 existing warnings; changed TypeScript files passed focused lint. `git diff --check` passed.

## Reproduction and boundaries

The [validation receipt](assets/chat-first-turn-fix/validation.json) binds source and fixture digests to the tested revision and records logs. From this workspace:

```sh
python3 /Users/jappy/.cyrus/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/chat-native-thread-fix/qa-clean-run.py pnpm --filter bobs-factory-edge-worker exec vitest run test/ChatSessionHandler.model-recovery.test.ts test/ChatSessionHandler.continuation.test.ts test/RunnerConcurrency.test.ts test/WorkflowNativeRecovery.test.ts test/SessionChat.test.ts test/MachineCapacity.test.ts test/IntegrationCapacity.test.ts test/WorkflowPendingWorkAdmission.test.ts --maxWorkers=1
F1_AGENT_MODE=mock F1_RECEIPT_PATH=/Users/jappy/.cyrus/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/chat-first-turn-fix/queued-first-chat-receipt.json python3 /Users/jappy/.cyrus/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/chat-native-thread-fix/qa-clean-run.py bun run /Users/jappy/.cyrus/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/chat-first-turn-fix/queued-first-chat-f1.ts
F1_AGENT_MODE=mock F1_RECEIPT_PATH=/Users/jappy/.cyrus/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/chat-first-turn-fix/established-catalog-receipt.json python3 /Users/jappy/.cyrus/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/chat-native-thread-fix/qa-clean-run.py bun run /Users/jappy/.cyrus/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/chat-first-turn-fix/established-chat-f1.ts
pnpm lint
```

The handler, production configuration/runner factory, persistent capacity, catalog and protected recovery API execute normally. Providers, transports and title jobs are simulated; real agents and live Slack/Zulip remain untested. A crash after the durable provider-start checkpoint has uncertain provider effects, so missing IDs remain recovery errors. Older saved chats without a startup marker also retain that conservative error; absence of an ID alone cannot prove that no conversation existed. UI code is unchanged, so prior accepted visual evidence remains applicable. External ticket synchronization remains unconfirmed. Reviewer reassessment and subsequent gates remain required; the PR remains draft and unmerged.
