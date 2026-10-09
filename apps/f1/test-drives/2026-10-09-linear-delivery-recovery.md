# Linear delivery recovery

Date: 2026-10-09. Base: `e2060c51`. Validation uses mocked agents and controlled
Linear SDK responses; no inference API or production tracker mutations occur.

Production inspection found 2,541 pending transcript entries and final workflow
results waiting on delivery. Linear returned `INPUT_ERROR` with the exact message
`Entity not found: AgentActivity` for two ambiguous writes. Recovery did not
recognize that confirmed absence, and `post` awaited the entire shared drain even
after its own final response had been delivered.

The regression suite first failed all three cases: SDK error wrapping in both
forms, and completion while an unrelated transcript write remains pending. The
fix recognizes confirmed absence of the queried entity while preserving other
ambiguous errors, reuses the original delivery ID, and releases a caller only
after its own receipt is durably saved. All 60 Linear transport tests passed. The additional operational-thought case
places older routine backlog first and verifies the milestone receives priority.

The scoped F1 drive seeds a real private delivery store with an ambiguous final
response and an unrelated pending thought. A built EdgeWorker uses the standard
F1 mock handlers and a one-step implementation workflow. The actual F1 CLI creates
DEF-1 and starts session-1. Its result milestone reaches the production tracker
adapter, native operational publisher and outbox with controlled SDK responses.
The native publisher emits a thought, with explicit operational delivery priority;
the unrelated thought is older in the persisted queue.

Assertions passed: the missing activity is retried with the same ID, exactly two
mutation attempts occur (initial failed request plus successful retry), the run
completes with one implementation history receipt while unrelated backlog remains
pending, and no model credits are used. The backlog is released and the fixture
worker stopped after assertions.

Commands:

```sh
pnpm --filter bobs-factory-linear-event-transport test:run
pnpm build
node node_modules/.cache/linear-recovery/fixture.mjs
BOBS_FACTORY_PORT=3812 apps/f1/f1 create-issue --title 'Recover Linear transcript delivery' --description '[workflow=delivery-recovery] Complete the mock implementation despite an unrelated transcript backlog.'
BOBS_FACTORY_PORT=3812 apps/f1/f1 start-session --issue-id issue-1
```

The fixture and receipt remain under `node_modules/.cache/linear-recovery` in the
local `factory-recovery` worktree. This validates tracker/EdgeWorker lifecycle and
receipt persistence. It does not claim live provider execution or exhaustive
Linear outage coverage. Lost-but-accepted writes, credential rotation, rate-limit
cooldowns, durable comments and restart deduplication retain their existing tests.
