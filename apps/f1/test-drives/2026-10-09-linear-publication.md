# Readable Linear publication — Taskbot #101

**Date:** 2026-10-09
**Tested base:** `3e117128f77ecf256b1f7866f65906b33c83e9fb`, with the uncommitted implementation in this checkout.
**Mode:** simulated agents, SDK 64.0.0, isolated loopback GraphQL provider. No model credits or live Linear workspace.
**Fixture:** [linear-publication-101.ts](assets/linear-publication-101.ts).

The changes affect public issue-tracker delivery, role output presentation, activity rendering and recovery. The fixture drives the real WorkflowRuntime, FactoryTools decision hook, TicketTracking, AgentSessionManager, LinearActivitySink, shared presenter and LinearIssueTrackerService. MockAgentRunner supplies role outputs. It uses an isolated CLI ticket store for reads and lifecycle status; Git handoff/merge receipts are simulated. The agent hook invokes result validation and presentation explicitly. It does not exercise EdgeWorker startup, native agents or actual provider rendering.

```sh
F1_AGENT_MODE=mock pnpm --filter bobs-factory-core exec tsx "$PWD/apps/f1/test-drives/assets/linear-publication-101.ts"
```

Result:

```json
{"result":"PASS","mode":"mock","standaloneDocumentationComments":1,"operationalComments":0,"clarificationEvents":1,"deliveryResponses":1,"restartDuplicates":0,"nestedAndParallel":true,"localMessages":18,"unhandled":0}
```

The scenario waits for one complete numbered clarification with choices and a recommendation. A submitted answer resumes the workflow. Decision documentation contains only the answer and rationale. Plans and implementation results remain local; operational outcomes use thoughts. Parallel and nested review roles complete. Identical CI waits coalesce, while failure and resume transitions remain visible. The simulated confirmed merge produces one useful final response; no separate delivery-summary comment is sent. Restarting delivery/tracking does not repeat any event. Raw provider messages and role-specific session evidence remain available locally. Ephemeral loopback listeners and the temporary home are cleaned up.

The existing #104/#110 fixture was also rerun unchanged:

```sh
F1_AGENT_MODE=mock bun run apps/f1/test-drives/assets/linear-delivery-104-110.ts
F1_AGENT_MODE=mock pnpm --filter bobs-factory-core exec tsx "$PWD/apps/f1/test-drives/assets/linear-delivery-104-110.ts"
```

Bun 1.3.5 automatically replayed the deliberately destroyed connection with the same ID, so its assertion expecting one pending ambiguous receipt failed. Diagnostic evidence showed two POSTs with the same identity, not two logical deliveries. The unchanged fixture passed under Node 24.20.0: six requests, four accepted mutations, zero pending deliveries, one runner start and zero unhandled rejections. Credential rotation also passed with four requests and three delivered activities after the controlled cooldown. Historical evidence and its fixture were preserved.

## Follow-up verification and accepted limitations

The initial run could not perform process inspection: `MachineCapacity.processStart()` failed with `spawn EPERM` (`ps -p ... -o lstart=`). After process access was restored, both affected suites passed all 120 tests, including the full EdgeWorker decision-documentation integration and three capacity-dependent WorkflowRuntime cases.

```sh
pnpm --filter bobs-factory-edge-worker exec vitest run test/WorkflowRuntime.test.ts test/EdgeWorker.decision-documentation.test.ts --maxWorkers=1 --testTimeout=60000
```

The accepted plan additionally requires inspecting rendered comments and the native transcript in an authorized live Linear test issue/session, using headless browser automation. The subsequent human answer authorized creating a test ticket and suggested the agent named Bob. The available connectors and saved Factory credential expose Niotix Grid, with MEE6 as the configured app identity; a complete user listing and exact lookup found no Bob. Created unassigned [NG-871](https://linear.app/digimondo/issue/NG-871/bobs-factory-101-controlled-linear-publication-test) with no workflow labels or real-agent assignment.

The shared presenter and actual LinearIssueTrackerService delivered one readable decision-documentation comment to NG-871 using simulated content. Repeating the same delivery and reopening the outbox returned the same comment ID. A live API read confirmed exactly one matching comment. The bounded check uses the existing credential binding without printing it. Its receipt and repeatable check are saved as `linear-live-provider-101.json` and `linear-live-check-101.mjs` in the run evidence directory.

The fresh named headless browser reached Linear's login page, so rendered comments and the native transcript remain uninspected. The screenshot `linear-login-required-101.png` was inspected and shows the sign-in requirement. Only that test browser was closed. No real agent or provider-credit validation ran. Provider guidance says response/elicitation/error activities may create threaded comments; outbound requests and comment API reads do not prove their live rendering. See [Linear interaction guidance](https://linear.app/developers/agent-best-practices).

On 2026-10-09, the human confirmed that MEE6 is the intended app identity and explicitly instructed this role to skip further actual Linear testing and focus on the changed content and formatting. This supersedes the plan's remaining live rendering check. The simulated publication, recovery and workflow checks remain the evidence for those behaviors. Live rendered comments and the native transcript are an accepted unverified limitation, not a passed check. NG-871 remains an unassigned test fixture with one documentation comment.

Local logs: `/tmp/f1-101-publication.log`, `/tmp/f1-101-delivery-node.log`, `/tmp/f1-101-delivery-existing.log`. These logs are local evidence, not public links.
