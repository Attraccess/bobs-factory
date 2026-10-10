# Factory external ticket delivery

Date: 2026-10-09. Originating task: [Taskbot 95](https://taskbot.apps.janjaap.de/p/bobs-factory/t/95).

The isolated drive passed 15 external workflow assertions. A separate mixed guide rendering check passed on desktop and mobile. Agents were simulated throughout; ticket requests used the production configured Taskbot client against a local HTTPS JSON-RPC fixture. No production tickets, real provider accounts or forge deliveries were changed.

## Tested implementation

Base commit: `985ef48c659714dd06a393325817e0ec7c2ccfb5`, with uncommitted changes in `MANUAL-6b56c26c`. The implementation file receipt is `implementation-tree.json` in the evidence directory below. Its SHA-256 tree digest is `0b3bc4ccac34b0e7208c8408dad7cb96a217afd0ca9d8c873cebe8114710ea4c`; the report itself is excluded. The final change that reopens a settled run on renewed verification was covered afterward by the focused 17-test delivery suite and build/type checks.

F1 applies because this change affects standard Factory routing, configured ticket mutations, activity output, lifecycle synchronization and human review. The custom embedded fixture uses the real EdgeWorker and F1 `MockAgentRunner`/`f1AgentHandlers` boundary. It does not substitute an in-memory delivery service for the native transport exercised by the drive.

Evidence directory:
`/Users/jappy/.bobs-factory/factory/evidence/manual-974e31ba-750c-4015-8170-e3856b56c26c/external-f1`.

Isolated home and source repository:
`/var/folders/_r/fld8l71j7ts635hlb5vtgnb80000gn/T/external95-f1-RlVezA` and its `source` directory. The fixture seeds five tickets and starts standard Factory through `EdgeWorker.startManualFactoryRun`. Local endpoints are dashboard 46995, HTTPS Taskbot fixture 46996, control 46997 and worker 46998. A separate read-only mixed guide server uses 46994. Browser authentication uses a seeded session in the isolated authentication store; this does not test passkey enrollment.

## Commands and execution

The evidence directory contains `fixture.ts`, `drive.mjs`, `finish-drive.mjs`, `mixed-preview.mjs` and `mixed-ui.mjs`, plus observed state and assertion results. The embedded fixture was launched with `F1_AGENT_MODE=mock`, `NODE_EXTRA_CA_CERTS` pointing to its fixture-only certificate, `BOBS_FACTORY_FACTORY_PORT=46995` and `BOBS_FACTORY_DISABLE_REMOTE_SESSION_STORE=1`. Resuming it used `F1_FIXTURE_HOME` and its saved state, preserving workflow checkpoints and native call counts.

Browser startup and driver commands used the same fresh headless session:

```sh
agent-browser --headed false --session external95-releasecheck-974e31ba open http://localhost:46995
node "$EVIDENCE/external-f1/drive.mjs" "$EVIDENCE/external-f1"
node "$EVIDENCE/external-f1/finish-drive.mjs" "$EVIDENCE/external-f1"
node "$EVIDENCE/external-f1/mixed-preview.mjs" "$EVIDENCE/external-f1"
node "$EVIDENCE/external-f1/mixed-ui.mjs" "$EVIDENCE/external-f1"
```

`EVIDENCE` denotes the parent evidence directory above. Playwright connected only to this named headless agent-browser session. No visible browser or existing user browser was attached.

The main driver passed the first 11 assertions before recovery fixture setup attempted to clone a live session containing runner functions. This was a fixture setup error. The fixture was corrected to use its serialized saved session snapshot. The incomplete synthetic run was retained as `abandoned-fixture-setup.json`; the worker resumed the same isolated home and ticket state. `finish-drive.mjs` passed the remaining four assertions. This was a continued drive, not an uninterrupted fresh run. Final output was `EXTERNAL_F1_PASS 15`; `results.json` includes the additional passing mixed browser assertion.

## Assertions and results

All of the following passed:

1. Standard Factory edits a description and blocking relationship through the configured HTTPS Taskbot client. It reaches external human review with a clean worktree and no draft PR, CI or merge output. The ticket is In Review.
2. EdgeWorker records role activities and lifecycle comments.
3. The authenticated review API rejects a stale external digest with HTTP 409.
4. Restart preserves the pending gate and mutation receipts without repeating content or relationship writes.
5. The external guide renders linked tickets, before/after records and independent acceptance criterion evidence.
6. Item feedback remains available through Decide. The actions read “Request changes” and “Accept completed work”; unsupported repository refresh is absent.
7. Request changes retains feedback and the applied blocker. A reviewed version-two contract produces a new acceptance gate without duplicating the relationship.
8. A new relationship observed during final checking prevents Done and creates fresh evidence, a drift warning and another human acceptance gate.
9. Failed lifecycle synchronization retains valid external completion proof.
10. Tracking-only retry reads current content and refuses stale Done after concurrent drift. It does not repeat task mutations.
11. Explicit Reverify obtains renewed human acceptance, then closes the ticket without replaying edits.
12. A synthetic failed publication run renders the reviewed external recovery form.
13. Recovery rejects unauthenticated access with HTTP 401 and accepts authenticated submission with HTTP 202. It verifies already-applied work without replaying edits, retains the original workflow/checkpoint/failure output and records the operator.
14. Recovery evidence and pending acceptance survive restart. Completion requires explicit acceptance.
15. Execution deferral asks for authorization before any ticket mutations.
16. A separate mixed rendering fixture shows a real local README diff alongside independently verified ticket evidence on desktop and mobile, with no horizontal overflow.

The mixed rendering fixture uses a synthetic forge URL and a local Git review snapshot; it does not establish actual publication or merge. Mixed completion safeguards, retained confirmed merge proof and the correction route after merge are covered by the delivery integration tests.

## Supporting checks

```sh
F1_AGENT_MODE=mock pnpm --filter bobs-factory-edge-worker test:run --maxWorkers=1 test/TicketDelivery.test.ts test/FactoryPipeline.test.ts test/TicketTracking.test.ts test/Guide.test.ts test/FactoryServer.test.ts test/WorkflowRuntime.test.ts test/FactoryReviewState.test.ts test/ReviewModel.test.ts test/ReviewRecovery.test.ts test/FactoryWebClient.test.ts
pnpm --filter bobs-factory-linear-event-transport test:run test/LinearIssueTrackerService.test.ts
pnpm --filter bobs-factory-edge-worker typecheck
pnpm --filter bobs-factory-edge-worker build
```

The combined edge-worker suite passed 276 tests across 10 files. The native Linear adapter suite passed eight tests, including full relationship pagination and inverse symmetric-link removal. After the final settled-view fix, the focused delivery suite passed all 17 tests again. Build, TypeScript, changed-file Biome checks and whitespace checks passed. Dependency installation used the frozen lockfile; no dependency manifests or lockfile changed.

Inspected screenshots are `ticket-changes-desktop-final.png`, `external-decide.png`, `external-drift-warning.png`, `external-recovery-form.png`, `mixed-guide-desktop.png` and `mixed-guide-mobile.png`. Screenshots supplement driver assertions; the Decide viewport does not itself show the buttons below the fold. `final-state.json` retains workflow, ticket and transport observations.

## Limits and cleanup

Real model behavior, production Linear/Taskbot permissions and actual forge publication/merge remain untested. No provider credits were consumed. Native Linear behavior is adapter-test evidence, not a live Linear drive. Configured Legacy Linear integration is supported; explicit execution profiles without a native tracker credential binding fail closed. Providers without conditional writes retain a race between reading state and dispatching a mutation, which receipts and fresh verification expose.

Earlier process-inspection and Chromium sandbox failures were resolved by the repaired execution environment. The formerly blocked runtime/server checks now pass. Production NG-850 and its historical run were untouched. Cleanup stops only the isolated worker, local fixture servers and named headless browser; evidence is retained.
