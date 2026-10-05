# Combined factory trigger, chat and output recovery validation

Date: 2026-10-05. Taskbot #64 / #65. Tested runtime: `a99cb39d5fc72a8e2592957d0bbb56560c7ac426` (compiled production code from `965ef4af`, followed by test-only fixture updates). PRs [#3](https://github.com/Attraccess/bobs-factory/pull/3), [#4](https://github.com/Attraccess/bobs-factory/pull/4), [#5](https://github.com/Attraccess/bobs-factory/pull/5), [#6](https://github.com/Attraccess/bobs-factory/pull/6), incorporating merged trigger PR #2.

F1 applies because conflict resolution joins trigger permissions/caller receipts, inherited nested chat and persisted output correction. Existing individual reports remain valid historical evidence.

## Combined checks

- Full edge-worker: 1,005 passed, one existing skip; core: 198; Codex: 75; MCP: 39. Full build/typecheck and commit hooks pass.
- Updated three old chat fixtures to the trigger-aware selection/origin contract. Existing Simple detail/continuation looks up settings without requiring a new launch permission; a protected API regression verifies continuation/detail after all Simple launch permissions are disabled.
- Combined graph execution preserves both workflow identity/call receipts and chat inheritance. Output correction retains the v2 contract and frozen accepted launch definitions.

## Native issue-tracker paths

Compiled EdgeWorker, real native Codex (`gpt-6.1-sol`, low effort), CLI issue tracker/activity sink, factory-context MCP. RPC 3600, factory API 3498. Fixtures are isolated from the installed service.

```sh
CYRUS_PORT=3600 ./apps/f1/f1 create-issue --title 'Merged trigger and guide correction' --description 'Return invalid then correct without changing accepted evidence.' --labels guide-correction
CYRUS_PORT=3600 ./apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3600 ./apps/f1/f1 create-issue --title 'Merged nested chat and trigger receipt' --description 'The initial color is red.' --labels chat-parent
CYRUS_PORT=3600 ./apps/f1/f1 start-session --issue-id issue-2
```

The parent recipe enables chat and ticket/manual starts; its internal child permits workflow calls only and inherits chat. While its native role runs, protected POST `/api/runs/session-2/messages` steers red to blue (202). The final result is blue; history contains `nested/inspect` and `nested`, with caller `chat-parent`, child `chat-child` and a label-selected CLI ticket-assignment receipt. A forged direct manual start of the child is rejected with 409 before startup. Revoking parent ticket starts leaves the accepted run's frozen definition intact; a new labeled issue gets an actionable response and no factory run. Native tool/final-result activity is visible.

The first guide fixture reused a repository after an earlier capture-budget fixture added `budget.py` to its HEAD-relative diff. The helper's corrected guide omitted that unintended file. The validator correctly rejected it and exhausted exactly two corrections; this fixture setup failure is not claimed as a passing guide check. State retained under `/tmp/factory-merged-main-home`.

A fresh repository `/tmp/factory-merged-main-repo` commits helper files in the base, with only `feature.ts` changed. Fresh state `/tmp/factory-merged-main-final-home`, worker `/tmp/factory-merged-main-final-worker.mjs`. Repeated issue-1 guide fixture completed after rejecting `base-only.ts` and supplying precise `/chapters/files` feedback. It retains only `[capture, guide]` history and exactly `feature.ts` chapter coverage. The accepted image is unchanged; no capture replay occurs. Saved native guide conversation: `01a10c27-70a6-7380-b42f-5a3633366f08`. CLI pagination shows timestamped tool activity. Full native recovery and legacy correction coverage is documented in the earlier output-recovery report; this drive checks the merged boundaries.

A graceful completed-fixture restart verifies history, accepted outputs, frozen definitions, original trigger receipt and native guide ID remain identical. The initial restart helper appended duplicate custom recipes; making its fixture registration idempotent fixed that test harness setup issue. No product change was needed.

This is local CLI/F1 coverage, not real Linear webhook delivery or visual QA of the application. No production prompt, application approval or application merge was issued. Fixture workers are stopped after validation.
