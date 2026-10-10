# Standalone chat Resume: accepted-model QA fix

**Date:** 2026-10-10  
**Tested revision:** `cb06e9313d7b9e152c99713a4d8b2100def6ec2b`  
**Mode:** simulated agents (`F1_AGENT_MODE=mock`)

Explicit Resume now restores the saved turn's accepted model and queued dashboard input. The existing automatic recovery path already did this; the explicit path now uses the same recovery flag. This addresses `QA-CHAT-MODEL-DRIFT` and the reopened saved-compatibility criterion `qa-aef6d69bbf43ce5b`.

## Verification

- The new Slack and Zulip regression cases failed before the correction: `future-chat-model` reached the runner instead of `accepted-chat-model`. Both pass after the fix. They also compare the complete saved pending execution, native ID, prompt deliveries and completion.
- All **192 tests across five suites passed**: ChatSessionHandler.continuation, WorkflowNativeRecovery, WorkflowRuntime, FactoryPipeline and SessionChat.
- The extended simulated F1 fixture completed with exit **0**. It disables an executing chat, waits for stop and capacity release, enables without continuation, changes preferences, serializes and recreates the chat handler, rejects recovery without a saved conversation, then performs individual HTTP Resume.
- The resumed runner used **accepted-chat-model** while current preferences remained **future-chat-model**. The native thread remained identical, the saved follow-up executed, status became complete and the block cleared. See [chat receipt](assets/chat-model-qa-fix/chat-recovery.json).
- Retained ticket conversation, attachments and execution settings, missing-repository error/block preservation, manual Simple operator Resume, saved question/checkpoint recovery and catalog import/export assertions also passed. See [ticket receipt](assets/chat-model-qa-fix/ticket-recovery.json), [failed recovery receipt](assets/chat-model-qa-fix/missing-repository.json) and [catalog receipt](assets/chat-model-qa-fix/catalog.json).
- Edge-worker build/types and workspace commit-hook build/types passed. Workspace lint passed with **19 existing warnings**, none in changed files. Diff whitespace checks passed.

## Commands and evidence

```sh
python3 /Users/jappy/.cyrus/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/chat-model-fix/qa-clean-run.py pnpm --filter bobs-factory-edge-worker exec vitest run test/ChatSessionHandler.continuation.test.ts test/WorkflowNativeRecovery.test.ts test/WorkflowRuntime.test.ts test/FactoryPipeline.test.ts test/SessionChat.test.ts --maxWorkers=1
F1_AGENT_MODE=mock F1_RECEIPT_PATH=/Users/jappy/.cyrus/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/chat-model-fix/catalog-receipt.json python3 /Users/jappy/.cyrus/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/chat-model-fix/qa-clean-run.py bun run /Users/jappy/.cyrus/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/chat-model-fix/qa-fix-extended-f1.ts
pnpm --filter bobs-factory-edge-worker build
pnpm --filter bobs-factory-edge-worker typecheck
pnpm lint
```

The fixture is a fresh copy of the QA reproduction supplied by the previous capture. Only evidence output paths changed. The [validation receipt](assets/chat-model-qa-fix/validation.json) records its digest, tested revision and log paths. The disposable home/repository and listeners were removed on completion. Historical failed receipts were preserved.

## Limits

Provider runners were simulated; no real-agent or live-integration validation is claimed. UI code is unchanged, and the gate already accepted all selected screenshots and recordings. These checks supply fresh evidence for the two failed recovery/compatibility criteria. Independent reviewer reassessment and later pipeline gates remain required; this report does not approve or merge the draft PR.
