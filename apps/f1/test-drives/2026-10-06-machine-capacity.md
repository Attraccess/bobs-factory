# Machine capacity across participating workers

**Date:** 2026-10-06  
**Task:** [bobs-factory #37](https://taskbot.apps.janjaap.de/p/bobs-factory/t/37)  
**Revision:** `d15270342c09fb7ab6476a5ab71dfc8415b2d388` plus the uncommitted implementation on `factory/manual-2fbfe0ef-dbff-4400-9a37-ecf459304b8c`. No PR, deployment or production restart was performed.

F1 applies because admission, cancellation, session continuation, activity posting and recovery changed. The capacity assertions below passed. The complete provider-backed drive was **partially limited** by provider spending limits and the F1 tracker's in-memory state after restart. These limitations are distinct from the passing automated regression checks.

## Isolation and commands

The test repository was `/tmp/f1-capacity-manual-59304b8c`, initialized with F1's `init-test-repo`. Two actual EdgeWorkers used different state homes, `/tmp/f1-capacity-manual-59304b8c-home-a` and `...-home-b`, and one coordinator at `/tmp/f1-capacity-manual-59304b8c-pool`. The coordinator was set to one slot for the workflow/browser drive. Factory ports were 3467/3468; F1 RPC ports were 3617/3618. No production coordinator or live run history was used.

The isolated bootstrap imports this worktree's built `EdgeWorker`, uses the CLI issue tracker and the real Claude runner, and preserves the two homes between graceful restarts. The normal F1 server creates a fresh home on startup, so it was unsuitable for that recovery assertion. Bootstrap scripts and compact API evidence are saved in the supplied evidence directory:

`/Users/jappy/.cyrus/factory/evidence/manual-2fbfe0ef-dbff-4400-9a37-ecf459304b8c`

```sh
apps/f1/f1 init-test-repo --path /tmp/f1-capacity-manual-59304b8c
CYRUS_CAPACITY_DIRECTORY=/tmp/f1-capacity-manual-59304b8c-pool \
  CYRUS_DISABLE_REMOTE_SESSION_STORE=1 CYRUS_FACTORY_PORT=3467 \
  node /tmp/manual-59304b8c-worker.mjs /tmp/f1-capacity-manual-59304b8c-home-a 3617
# Second worker: the same coordinator, Factory port 3468, home-b, RPC port 3618.
CYRUS_PORT=3618 apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3618 apps/f1/f1 view-session --session-id session-1 --limit 100 --offset 0
CYRUS_PORT=3618 apps/f1/f1 view-session --session-id session-1 --limit 100 --offset 30
curl -X PUT http://127.0.0.1:3468/api/capacity \
  -H 'content-type: application/json' -H 'x-factory-request: 1' -d '{"limit":1}'
```

Recipes were installed through the protected workflows API. Manual runs used the composer API. `capacity-script` fans out three intensive leaves: a shell script, `tool: exec`, and another shell script. `capacity-nested` calls that recipe without owning a parent slot. `capacity-agent` asks a question through its completed JSON result, then resumes from the persisted answer.

## Assertions and observations

| Scenario | Result |
| --- | --- |
| Real issue-triggered agent competes with another worker's intensive script | Worker B's `session-1` reported `capacity-waiting`; its `ask` leaf was queued at sequence 30. Worker A's holder was executing, aggregate usage was one, and the title was separately queued. The provider started after the holder released. |
| Mixed fanout | API/UI showed one executing leaf and two queued leaves. The run remained running. The manual script run `manual-103095a5-2072-4f6c-b9b6-3df31d764240` completed all three leaves and its fanout receipt. |
| Limit-one nested fanout | B's `manual-b0742799-ba3c-4f68-9d6f-69bef90645da` completed its three leaves and workflow call. Leaf completions were 16:38:16.266, 16:38:18.545 and 16:38:20.694 UTC. Parent orchestration did not deadlock the pool. |
| Cancel queued work | The mobile stop confirmation stopped `manual-ef2a496c-4ac7-4487-8774-b2887cf6c499`. API status was stopped and no matching request remained. It stayed stopped across restart. |
| Human wait | A's first agent result checkpointed a question. It owned no capacity while waiting; answering changed it to running through admission. The mobile answer form appeared only in the human wait, not in capacity queueing. |
| Graceful restart and continuation | The unfinished answer attempt rejoined sequence 19 with its saved native conversation. A's run completed with `Capacity test resumed`. Completed manual receipts remained unchanged, and the stopped B run remained terminal. |
| Passive CI | A controlled tool hook kept a real WorkflowRuntime/FactoryServer run pending in `waiting-ci`, with no coordinator request for that run. The browser showed Waiting for CI and no answer form. This was a controlled pending-CI fixture, not a live GitHub CI drive. |
| Provider error cleanup | B's answer continuation eventually hit HTTP 429/monthly spend limits. It became failed, its leaf metadata cleared, and the shared snapshot returned zero active, stopping and queued requests. |
| Shared settings and reconnect | A browser edited the limit while B changed it via API. The effective limit updated through SSE, while the unsaved input stayed intact. Enter saved the typed limit. Reload after the isolated restart resynchronized state. |
| Input/protection | Browser rejected zero through native minimum validation. API regressions reject nonpositive/fractional limits, missing write headers and invalid origins. |

The compact snapshots are in `capacity-drive-evidence.json`. Preserved F1 activity pages show timestamped thought, action and response records, including the initial provider question and the Factory clarification response. Both pages were read through the final activity count of 33. The tracker does not retain every post-error event as an activity; the worker log records the final provider-limit response.

## Automated verification

- `pnpm install --frozen-lockfile` passed; no dependencies changed.
- Core JSON schema regeneration passed.
- `pnpm lint`, `pnpm typecheck` and `pnpm build` passed. Lint retains 24 existing warnings.
- `pnpm test:packages:run --maxWorkers=2` passed across packages, including 99 EdgeWorker files with 1,132 passing tests and one skip. After the final fixes, the affected suites below were rerun.
- Seven runtime/configuration/capacity/recovery/chat suites passed 112 tests. Final capacity/title suites passed 29 tests, including the added killed-queued-owner test. Final runner-selection/title/web-client suites passed 64 tests.
- `pnpm --filter cyrus-claude-runner test:run --maxWorkers=2` passed 127 tests, including two regressions rejecting an identical effective fallback model.
- `pnpm --filter cyrus-ai exec vitest run src/services/WorkerService.test.ts --maxWorkers=2` passed all seven configuration-forwarding tests.
- `git diff --check` passed.

`MachineCapacity.test.ts` starts two real Node worker processes with different homes. Controlled agent/script/tool workload callbacks spawn actual commands and record 12 start/end events; the observed maximum is asserted to be two at a limit of two, with zero remaining execution. These callbacks test the shared service and process boundaries, not three real provider SDKs. The separate F1 scenario above supplies real-provider coverage.

Additional process tests kill an executing owner with SIGKILL and verify its surviving tagged command is dead before new admission. Another kills a queued owner, restarts its identity, verifies the same request ID/sequence, and records exactly one start/end pair. Runtime tests cover sibling cancellation, passive CI, nested limit-one execution, admission cancellation and restoration. Title tests wait for the runner to settle before releasing its lease.

Initial unrestricted package/CLI runs overloaded short test timeouts and were stopped. They are not counted as passing. Package tests passed with bounded workers after coordinator transactions and snapshot polling were serialized/coalesced. The unrelated full CLI release-script suite was not claimed as passing; the required affected CLI suite passed.

## Browser evidence

Desktop verification used 1440×1000; mobile used 390×844. All screenshots below were inspected. Settings captures show the final built UI and an idle pool after the provider error drained. Workflow captures were taken during the live assertions.

- [Desktop settings](assets/2026-10-06-machine-capacity-desktop.png)
- [Mobile settings](assets/2026-10-06-machine-capacity-mobile.png)
- [Mixed executing/queued nested fanout](assets/2026-10-06-machine-capacity-fanout.png)
- [All-queued issue agent](assets/2026-10-06-machine-capacity-issue-queued.png)
- [Human question](assets/2026-10-06-machine-capacity-human-wait.png)
- [Controlled passive CI wait](assets/2026-10-06-machine-capacity-ci-wait.png)
- [Confirmed queued stop](assets/2026-10-06-machine-capacity-stopped.png)

The human-wait capture includes an auxiliary title failure from the earlier build. Its identical default fallback was fixed afterward in ClaudeRunner and checked by the runner regression suite. Successful live title generation was not rerun after the provider exhausted its spending limit.

## Limits and cleanup

The first resumed issue completed after restart, but the F1 CLI tracker's in-memory session record was gone; its post-restart activity delivery could not be verified. A fresh second-worker issue verified real activity posting and the question checkpoint, then failed during answer continuation because of provider spending limits. This drive therefore does not establish a clean post-restart final-response timeline or a successful post-fix provider title.

The implementation's documented boundary is scheduled executions on POSIX hosts, not every subprocess or thread. Unsupported harness delegation remains constrained by supported permissions/settings and instructions. Unverified cancelled external MCP/Cursor execution retains its slot until external termination can be established; tests verify that conservative behavior.

All owned isolated servers were gracefully stopped after evidence capture. The isolated pool was empty before shutdown. Production processes, production capacity state and historical test-drive reports were left untouched.
