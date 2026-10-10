# Chat Resume through production runner wiring

**Date:** 2026-10-10  
**Tested revision:** `80e90f11eca492b4e2969f7adf95961c8a7f8b65`  
**Mode:** simulated agents (`F1_AGENT_MODE=mock`)

Chat execution now resolves its selected model before saving the pending turn. The production chat runner factory respects that model on Resume. This addresses both `integration-review:QA-CHAT-MODEL-DRIFT` and `integration-review:qa-aef6d69bbf43ce5b`.

## Checks

- The new Slack and Zulip regression cases use the production handler, config builder, selector and chat runner factory. Both failed on the old implementation because the pending execution had no model. Both pass after the fix. They verify initial and continuation persistence, JSON serialization into a new handler, preserved runner/model/native ID/pending execution after defaults change, and replay of the interrupted prompt. Configs without a saved model still receive the current default.
- All **239 tests across 14 suites passed**, including chat continuation/recovery, saved runtime/pipeline compatibility and RunnerConfigBuilder checks. The initial broader run failed eight environment-sensitive checks because it inherited managed Factory settings. The isolated rerun passed all 239; no test expectations were weakened.
- The extended F1 drive passed with exit **0**. Its chat scenario now uses `EdgeWorker.buildChatSessionHandlerDeps`, the real RunnerConfigBuilder and RunnerSelectionService, and the production runner/capacity path. The previous fixture replaced the builder and factory; this drive observes the model received by the simulated provider runner.
- F1 started and held a standalone chat follow-up, disabled Simple, waited for execution/capacity release, re-enabled without continuation, changed model and runner defaults, and reconstructed the handler from saved state. Missing-conversation recovery returned 409. Individual HTTP Resume returned 202, used **accepted-chat-model** despite **future-chat-model** being configured, retained the native thread, replayed the pending turn, completed and cleared the block. See the [chat receipt](assets/chat-model-production-fix/qa-chat-model-drift-receipt.json).
- The same drive also passed ticket conversation/attachment recovery, missing-repository block retention, manual Simple operator Resume, migration/dependency admission and protected import/export. See the [catalog receipt](assets/chat-model-production-fix/catalog-receipt.json).
- Edge-worker build/types and the commit hook's workspace build/types passed. Workspace lint passed with 19 existing warnings; changed TypeScript files passed focused lint. Diff whitespace checks passed.

## Reproduction

The [validation receipt](assets/chat-model-production-fix/validation.json) records the fixture digest, production/control boundaries and complete evidence paths. Commands ran from this workspace:

```sh
python3 /Users/jappy/.cyrus/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/chat-model-production-fix/qa-clean-run.py pnpm --filter bobs-factory-edge-worker exec vitest run test/ChatSessionHandler.model-recovery.test.ts test/ChatSessionHandler.continuation.test.ts test/WorkflowNativeRecovery.test.ts test/WorkflowRuntime.test.ts test/FactoryPipeline.test.ts test/SessionChat.test.ts test/RunnerConfigBuilder --maxWorkers=1
F1_AGENT_MODE=mock F1_RECEIPT_PATH=/Users/jappy/.cyrus/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/chat-model-production-fix/catalog-receipt.json python3 /Users/jappy/.cyrus/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/chat-model-production-fix/qa-clean-run.py bun run /Users/jappy/.cyrus/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/chat-model-production-fix/production-chat-f1.ts
pnpm --filter bobs-factory-edge-worker build
pnpm --filter bobs-factory-edge-worker typecheck
pnpm lint
```

The drive removed its disposable repository/home and stopped its listeners. Historical failed evidence remains intact. Providers and chat transport were simulated; real-agent and live Slack/Zulip behavior remain untested. Old saved executions that never recorded a model cannot reconstruct it and retain the existing current-default fallback. UI code is unchanged, so previously accepted screenshots and recordings remain the visual evidence. Ticket synchronization remains unconfirmed. Reviewer reassessment and subsequent pipeline gates remain required; the PR remains draft and unmerged.
