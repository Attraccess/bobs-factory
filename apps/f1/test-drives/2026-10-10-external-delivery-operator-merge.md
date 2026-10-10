# External delivery integration with operator recovery

Date: 2026-10-10. Tested the merge worktree at head
`a658d64517546ce13feb2fb5ac7d81e16b38f3da` with fetched main
`21d84299e7e7f81b3c7fcd82c59b6c7e2e910a12`.
Only CHANGELOG.md and docs/PRODUCT_CONTRACTS.md conflicted; both branches'
entries were retained. Runtime integration was automatic.

## Executed checks

- Repository build passed before the final focused run.
- Nine edge-worker files: 316 tests passed across delivery, tracking, pipeline,
  dashboard server, runtime, delivery coordination, scheduling, machine capacity
  and configured MCP transport.
- The first test attempt used stale built workspace dependencies and reported
  scheduling errors. It was stopped; rebuilding and rerunning all nine files
  passed. The initial log remains available.
- Fresh isolated F1 used simulated agents and a configured synthetic Taskbot
  HTTPS service. Six assertions passed: cross-target relationship reconciliation;
  digest-bound acceptance; repeated conflicted retries after worker restart;
  mixed feedback with retained repository work; grouped reacceptance with both
  repository revisions; and asynchronous ticket closure without mutation replay.
- The retry assertions exercised the dashboard's newly shared operator recovery
  service. The driver stopped its isolated worker and fixture services.

Evidence directory:
`/Users/jappy/.bobs-factory/factory/evidence/manual-974e31ba-750c-4015-8170-e3856b56c26c/ci-fix-operator-f1`.
It contains fixture.ts, drive.mjs, fixture.log, drive.log, results.json and
final-state.json. Adjacent `ci-fix-main-operator-build.log`,
`ci-fix-main-operator-tests.log` and
`ci-fix-main-operator-tests-rebuilt.log` retain build and test receipts.

The fixture used `F1_AGENT_MODE=mock`, removed the inherited
`BOBS_FACTORY_INTERNAL_EXECUTABLE` source-launch override and started on port
46995. The driver ended with `MERGE_F1_PASS 6`.

## Limits

No real agents, production tracker permissions or actual forge publication/merge
were exercised. Mixed repository merge receipts were synthetic. This merge
changed no dashboard UI source relative to the preceding PR head, so browser
captures were not repeated. Earlier browser evidence remains historical. Fresh
CI, independent review and explicit human approval remain required for PR #80.
