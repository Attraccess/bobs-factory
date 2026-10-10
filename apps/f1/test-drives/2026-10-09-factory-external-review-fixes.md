# Factory external delivery review fixes

Date: 2026-10-09. Task: [Taskbot 95](https://taskbot.apps.janjaap.de/p/bobs-factory/t/95). Delivery: [draft PR #80](https://github.com/JappyJan/bobs-factory/pull/80).

All four review regressions passed focused runtime tests and an isolated F1 drive. Agents were simulated. Configured Taskbot requests used the production transport against a local HTTPS JSON-RPC fixture. Repository readiness and confirmed merges were synthetic receipts; no production tickets, real agents or forge deliveries were changed.

## Tested source and applicability

Tested base HEAD: `66c295ec7314b2beb15b3050321bdce34b2adf84`, with the review-fix working changes. `tested-source.json` records the exact production and regression-test file hashes. Its source receipt digest is `9999d6fd0f41b567cfab6b2cb7d8709eee9d62f1f8df679ebf69c1364b0a9790`.

F1 applies because these changes affect ticket reconciliation, mixed workflow correction and human acceptance. This drive exercises the real EdgeWorker, WorkflowRuntime, FactoryTools, configured Taskbot client, independent ticket reads, tracking and authenticated review API. `MockAgentRunner` and `f1AgentHandlers("mock")` supply role responses. The mixed repository implementation pauses at a controlled fixture boundary; initial forge readiness and two confirmed merges are supplied as synthetic evidence to isolate the changed correction and reacceptance paths.

Evidence directory:
`/Users/jappy/.bobs-factory/factory/evidence/manual-974e31ba-750c-4015-8170-e3856b56c26c/reviewfix-f1`.

Temporary Factory home:
`/var/folders/_r/fld8l71j7ts635hlb5vtgnb80000gn/T/external95-f1-fSTPNm`.

## Execution and observed results

The fixture uses dashboard port 46995, HTTPS tracker port 46996, control port 46997 and EdgeWorker port 46998. It was launched with `F1_AGENT_MODE=mock`, `BOBS_FACTORY_DISABLE_REMOTE_SESSION_STORE=1`, `BOBS_FACTORY_FACTORY_PORT=46995` and `NODE_EXTRA_CA_CERTS` pointing only to the fixture certificate. Restart used `F1_FIXTURE_HOME` and saved ticket/call state.

The scripts and results remain in the evidence directory. This was a continued drive, not an uninterrupted fresh run. Driver corrections fixed the expected Stop HTTP status (200), the native link argument name (`id`), missing configured repository identities in the synthetic grouped scope, and missing fields in the synthetic review guide. Those fixture failures are retained in the scripts and saved state; they did not require product changes.

Six assertions passed, recorded in `results.json`:

1. Adding 4→5 and then 5→3 succeeds through the configured tracker transport. Ticket 5 contains both relationships, and independent verification passes every criterion.
2. Cross-target delivery completes only after explicit acceptance of its verified digest.
3. A description edit introduced after plan review blocks the first operation. Repeated retry, including after EdgeWorker restart, remains blocked and dispatches no content write. The intervening human edit remains intact.
4. Rejecting initial mixed review with ticket feedback routes through correction planning, plan review, renewed application and independent verification before repository implementation resumes. The reviewed contract advances to version two. Existing PR evidence and the applied blocker are retained.
5. After two synthetic confirmed repository merges, renewed external review produces one fresh digest bound to both exact repository revisions.
6. Headless browser acceptance retains those revisions and the fresh digest, establishes final mixed completion proof, closes the fixture ticket and performs no task-mutation replay. No browser page errors occurred in the final check.

Commands used the fixture and driver files in the evidence directory:

```sh
F1_AGENT_MODE=mock bun run "$EVIDENCE/fixture.ts" "$EVIDENCE"
node "$EVIDENCE/drive.mjs" "$EVIDENCE"
node "$EVIDENCE/finish-drive.mjs" "$EVIDENCE"
node "$EVIDENCE/continue-drive.mjs" "$EVIDENCE"
node "$EVIDENCE/final-drive.mjs" "$EVIDENCE"
node "$EVIDENCE/headless-acceptance.mjs" "$EVIDENCE"
```

Here `EVIDENCE` is the full evidence directory above; fixture launches also used the environment values described above. Intermediate scripts stopped at the documented fixture failures. The final combined result was `REVIEWFIX_F1_PASS 6`.

## Browser evidence

Two isolated agent-browser sessions were started with `--headed false`: `reviewfix95-974e31ba` and `reviewfix95-confirm`. Browser DOM checks rendered the renewed ticket evidence and both repository revision links, but their Chromium screenshot calls timed out. Final capture and acceptance used a separate Playwright Chromium Headless Shell with `headless:true` and `--disable-gpu`. It was closed by the driver.

Inspected images: `grouped-reacceptance-desktop.png` and `grouped-reacceptance-decide.png`. They show the retained revision links, refreshed ticket warning and decision page. The viewport does not show all before/after content or the approval button below the fold; executed DOM and acceptance assertions establish those behaviors. The synthetic forge heads have no historical diff manifest, so the fixture file panel reports an unavailable diff. Existing repository-diff rendering evidence remains in the earlier external-delivery report.

## Supporting verification

```sh
F1_AGENT_MODE=mock pnpm --filter bobs-factory-edge-worker test:run --maxWorkers=1 test/TicketDelivery.test.ts test/FactoryPipeline.test.ts test/WorkflowRuntime.test.ts
F1_AGENT_MODE=mock pnpm --filter bobs-factory-edge-worker test:run --maxWorkers=1 test/FactoryRepositoryScope.test.ts
pnpm --filter bobs-factory-edge-worker build
pnpm --filter bobs-factory-edge-worker typecheck
pnpm exec biome check packages/edge-worker/src/factory/Delivery.ts packages/edge-worker/src/factory/FactoryTools.ts packages/edge-worker/src/factory/defaultWorkflows.ts packages/edge-worker/test/TicketDelivery.test.ts
git diff --check
```

The first three suites passed 183 tests, including 20 delivery tests. The repository-scope suite passed 11 tests. Build, typecheck, Biome and whitespace checks passed. Tests additionally establish that a new reviewed operation can resolve an intervening-edit conflict, and that grouped reacceptance satisfies the complete mixed proof without Git or forge replay.

## Limits and cleanup

Real model behavior, production tracker permissions and actual forge publication/merge remain untested. No provider credits were consumed. Providers without conditional writes retain a race between reading and dispatching; this existing limitation remains documented. Historical/frozen workflows are not rewritten by the stock correction-route change.

The isolated worker and tracker/control servers and both named headless sessions were stopped after validation. Evidence and temporary repositories are retained. Production recovery was not performed.
