# Linear publication review fixes — Taskbot #101

Date: 2026-10-09. Tested starting revision: `05b652cf0aa2c184a58e5f0dfd25ba5232a35284`, with the review-fix diff committed alongside this report. Historical publication evidence remains in its original report.

The fixture uses simulated agents and an isolated loopback GraphQL provider. It exercises WorkflowRuntime, TicketTracking, AgentSessionManager, LinearActivitySink, LinearIssueTrackerService and the durable outbox. The provider now models Linear's documented automatic threaded comments for response, elicitation and error activities. See [Linear interaction guidance](https://linear.app/developers/agent-best-practices).

```sh
F1_AGENT_MODE=mock pnpm --filter bobs-factory-core exec tsx "$PWD/apps/f1/test-drives/assets/linear-publication-101.ts"
```

Passed: two explicit documentation comments (decision rationale and confirmed delivery summary), zero implicit operational comments, one clarification, successful answer/resume, nested and parallel review completion, coalesced CI waits, visible CI failure, bounded build diagnostics, suppressed fenced review JSON and zero restart duplicates. Complete role messages remain local. The outbox integration test also asserts retention of the complete failed log alongside the diagnostic excerpt. Temporary listeners and fixture state are cleaned up.

The fixture result was:

```json
{"result":"PASS","mode":"mock","standaloneDocumentationComments":2,"operationalComments":0,"clarificationEvents":1,"deliveryResponses":0,"restartDuplicates":0,"nestedAndParallel":true,"localMessages":18,"unhandled":0}
```

Related checks passed:

- Core presenter: 8 tests; core build and typecheck.
- Complete Linear transport package: 62 tests, including direct and queued SDK presentation, durable questions/errors, priority, recovery and full local failure evidence.
- WorkflowRuntime, EdgeWorker decision documentation and LinearActivitySink: 151 tests.
- TicketTracking: 32 tests, including explicit confirmed-delivery documentation.
- EdgeWorker typecheck.

The full provider rendering and native Linear session badges remain unverified. The human explicitly requested skipping actual Linear tests; this run used no real agents or provider credits. The simulation checks Factory's waiting/completion state and outbound wire content, not native Linear rendering or badge transitions. Raw logs: `/tmp/f1-101-review-fixes.log`, `/tmp/linear-101-review-workflow-tests.log`, `/tmp/linear-101-review-tracking-tests.log`.
