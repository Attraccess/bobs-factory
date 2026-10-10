# Chat Resume with a missing native conversation ID

**Date:** 2026-10-10  
**Tested revision:** `a7ce8d035e85cd5a9a1c9569d2650ee8c9d60603`  
**Mode:** simulated agents (`F1_AGENT_MODE=mock`)

Explicit chat Resume now rejects a missing saved native conversation ID before creating a runner. The existing recovery path returns HTTP 409 and restores the durable block. The pending turn and accepted settings remain available for recovery. This addresses `QA-CHAT-NATIVE-THREAD-RECOVERY` on [PR #83](https://github.com/jappyjan/bobs-factory/pull/83).

## Results

- All **30 focused tests in four suites passed**. Slack and Zulip checks use the production handler, configuration builder, selector and chat runner factory. After serializing an established conversation and removing only its saved ID, Resume raises an actionable error, creates no runner, preserves status and pending execution, and sends no prompt. Restoring the ID permits the same turn to resume with its accepted model.
- The production-path F1 drive passed at the committed revision. It established a chat, held a follow-up, disabled Simple, confirmed execution and capacity release, enabled without continuation, changed model defaults and reconstructed the saved handler. Removing only its native ID produced **HTTP 409**, **zero new runners**, the exact original block and pending execution, and no replacement native ID. See the [missing-ID receipt](assets/chat-native-thread-fix/qa-production-missing-thread-receipt.json).
- After restoring the disposable fixture's original ID, individual HTTP Resume returned **202**, retained the native conversation and **accepted-chat-model** despite changed defaults, replayed the pending turn, completed and cleared the block. See the [normal Resume receipt](assets/chat-native-thread-fix/qa-chat-model-complete-receipt.json).
- The same drive retained passing ticket attachment/repository recovery, migration/dependency admission, manual Simple operator Resume and protected export/import checks. See the [catalog receipt](assets/chat-native-thread-fix/catalog-receipt.json). It stopped its listeners and removed its disposable home/repository.
- The commit hook's workspace build and type checks passed. Workspace lint passed with 19 existing warnings; changed TypeScript files passed focused lint. `git diff --check` passed.

## Reproduction and boundaries

The [validation receipt](assets/chat-native-thread-fix/validation.json) records source/fixture digests and full log paths. From the workspace:

```sh
python3 /Users/jappy/.cyrus/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/chat-native-thread-fix/qa-clean-run.py pnpm --filter bobs-factory-edge-worker exec vitest run test/ChatSessionHandler.model-recovery.test.ts test/ChatSessionHandler.continuation.test.ts test/WorkflowNativeRecovery.test.ts test/SessionChat.test.ts --maxWorkers=1
F1_AGENT_MODE=mock F1_RECEIPT_PATH=/Users/jappy/.cyrus/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/chat-native-thread-fix/catalog-receipt.json python3 /Users/jappy/.cyrus/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/chat-native-thread-fix/qa-clean-run.py bun run /Users/jappy/.cyrus/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/chat-native-thread-fix/production-chat-f1.ts
pnpm lint
```

The runner and HTTP recovery wiring are production code. Provider execution, chat transport and background titles are simulated; real agents and live Slack/Zulip remain untested. Explicit Resume cannot recreate missing conversation history; the saved ID must be restored. UI code is unchanged, so previously accepted visual evidence remains applicable. Historical failed receipts were preserved. Ticket synchronization remains unconfirmed. Reviewer reassessment and subsequent pipeline gates remain required; the PR remains draft and unmerged.
