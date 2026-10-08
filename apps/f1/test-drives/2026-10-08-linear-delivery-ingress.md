# Linear delivery and signed ingress — Taskbot #104 / #110

**Date:** 2026-10-08
**Tested base:** `61b0a608eef140149272d34b299a7b61a3a59999`, with the uncommitted improvement implementation in this checkout.
**Mode:** deterministic mocked agent, actual Linear SDK 64.0.0 against an isolated loopback GraphQL provider, controlled provider/time boundaries. No live Linear workspace, model API, native agent CLI, deployment, or production configuration was used.
**Fixture:** [linear-delivery-104-110.ts](assets/linear-delivery-104-110.ts). Both Fastify listeners use ephemeral loopback ports and a fresh temporary factory home; cleanup closes listeners and removes state.

## Why this drive applies

The changes affect signed issue ingress, Linear session activity delivery, throttling, durable retry, and restart recovery. The drive mounts the actual `LinearEventTransport`, then feeds the deterministic F1 `MockAgentRunner` through `AgentSessionManager`, `LinearActivitySink`, and `LinearIssueTrackerService`. The provider fixture returns a real GraphQL throttle and destroys an accepted final mutation's HTTP connection. This tests the changed delivery behavior through the public components; the separate embedded EdgeWorker ingress test exercises suppression of runtime-created transcript sessions.

## Assertions and results

```sh
bun run apps/f1/test-drives/assets/linear-delivery-104-110.ts
```

```json
{"result":"PASS","mode":"mock","publishedSources":15,"requests":6,"acceptedMutations":4,"runnersStarted":1,"pending":0,"delivered":4,"unhandled":0,"ports":"ephemeral"}
```

- The mounted signed route accepts all 15 snapshot sources, including `34.185.239.137`, `35.246.206.27`, and `35.246.210.220`. It rejects an invalid signature with 401 and an untrusted source forwarding an allowed address with 403.
- One throttle stops subsequent outbound mutations. Twenty unchanged CI progress attempts coalesce to one pending event; model progress, question, and final remain represented, with local final evidence retained in the session manager.
- Recovery sends the final and question before routine progress. Four events are accepted: model progress, final response, CI progress, and question.
- The final mutation is accepted but loses its receipt. Recreating the service/outbox and advancing the controlled clock reconciles its stable identity with a query. Exactly one final mutation is accepted; the agent starts once and is never replayed for delivery recovery.
- The total provider traffic is six requests: one rejected throttle, four accepted mutations, and one reconciliation lookup. The activity sink uses mutation receipt IDs without extra SDK relationship queries.
- Refreshing the source list changes the already mounted route. A later refresh failure retains that verified snapshot; an explicit custom list remains unchanged.
- All pending delivery is resolved, no unhandled rejection is observed, and cleanup completes.

Expected throttle, pending-delivery, lost-connection, invalid-signature, and refresh-failure diagnostics appear in the fixture log. They are controlled failures used to verify recovery and rejection, not an assertion of production incident frequency.

## Targeted checks

```sh
pnpm --filter bobs-factory-linear-event-transport test:run
pnpm --filter bobs-factory-edge-worker exec vitest run test/LinearActivitySink.test.ts test/ActivityPoster.test.ts test/TicketTracking.test.ts test/EdgeWorker.transcript-ingress.test.ts test/EdgeWorker.linear-client-wrapper.test.ts test/EdgeWorker.decision-documentation.test.ts --reporter=dot --silent
pnpm --filter bobs-factory-core exec vitest run test/security/WebhookIpValidator.test.ts --reporter=dot --silent
pnpm --filter bobs-factory-linear-event-transport build
pnpm --filter bobs-factory-edge-worker typecheck
pnpm --filter bobs-factory-f1 typecheck
```

Results: Linear transport 53 tests, EdgeWorker targeted checks 78 tests, source validation 77 tests; all pass. Build and both type checks pass.

The signed embedded EdgeWorker test verifies a persisted manual run binds its transcript session without a provider call or competing workflow, including webhook redelivery. Unknown links and mismatched issue/workspace bindings continue to normal routing. It uses isolated temporary homes, allocated ephemeral ports, and the F1 mocked runner factory.

The embedded decision-documentation test restores a native Linear run and starts
the actual EdgeWorker, FactoryTools `record-decisions` hook, TicketTracking policy
and durable outbox. Before explicit documentation purpose was added, the test
observed no issue comment because the decision was sent to the transcript. After
the fix, it confirms one complete durable decision comment and two lifecycle
thought activities, with the publication receipt marked delivered. Only the
external SDK is controlled; the worker uses the deterministic F1 runner factory.

## TDD evidence

Tests were added at public delivery, tracker, and signed-ingress boundaries and run before their production fixes. Observed RED failures included simultaneous SDK requests at `0/0/0` rather than `0/2000/4000`; pending finals lost across concurrent outbox instances; duplicate identity accepting different content; 23 pending unchanged/necessary events rather than three; lazy mutation relationship getters being read; manual transcript reconciliation lookup clearing a prior ambiguous creation marker; same-SDK wrapper rebuild stalling before any provider request; newly arrived question omitted from an existing progress drain; and a 30,413-byte completed payload retained instead of a compact receipt. The corresponding targeted checks passed after each minimal fix.

Additional behavioral checks cover independent credentials, provider Retry-After shared across sessions, questions and PR/status updates routed independently, documentation comment acceptance with lost receipt, replacement during an in-flight flush, malformed source refreshes, custom lists, and trusted-proxy boundaries.

## Provider evidence and limits

The [official Linear webhook source document](https://linear.app/.well-known/appspecific/app.linear.ips.json), fetched on 2026-10-08, lists 15 webhook IPv4 `/32` sources. Its separate `codingSessionIps` field is excluded. The [official rate-limit guidance](https://linear.app/developers/rate-limiting) supports shared request accounting and provider-directed cooldown; the default two-second spacing is conservative.

Installed SDK inspection confirmed `AgentActivityCreateInput.id` and `CommentCreateInput.id` are supported UUID identities, while session creation on an issue accepts `issueId`/`externalLink` and does not accept a client ID. Mutation receipt getters (`agentActivityId`, `commentId`, `agentSessionId`) avoid relationship fetches. Manual transcript creation therefore reconciles an exact issue/external-link binding; an ambiguous creation with no confirmed session remains visibly pending instead of creating another session.

This is controlled component and embedded-runtime evidence. It does not validate the real public tunnel, live provider limits, real source traffic, native model behavior, or historical lost-work volume. Operational milestones/questions are routed to the readable Linear transcript and documentation/deliverables remain comments; the wider transcript presentation redesign tracked separately in #101 is outside these two tickets.

## Credential rotation cross-review fix

The final review found that changing a client's access token retained its original request scheduler. Three public generated-SDK regressions were run RED before the fix: manual rotation and OAuth refresh both allowed a second client using the new token to send at elapsed `0` despite a `120000` ms provider cooldown; a request queued before rotation sent the new credential through the old scheduler at `2000` ms. The tests now pass. One mutable binding is shared by wrappers of the same SDK client, both token-update paths refresh it, and queued requests retain the effective headers associated with their selected budget. The existing same-SDK rebuild and in-flight outbox replacement checks remain green without nested schedulers.

The final loopback F1 run additionally starts a deterministic mocked agent through `AgentSessionManager` and `LinearActivitySink` using a tracker constructed with token A and rotated to token B. The real SDK receives HTTP 429 with Retry-After 120. Replacing the tracker with another SDK client using token B retains the final and a new question without another HTTP request during cooldown. Advancing the controlled clock by `120001` ms delivers the final, question, and thought through the latest owner. All four provider requests use token B, and the local final remains readable. The primary signed-ingress scenario still has six requests and four delivered activities; the independent rotation scenario has four requests and three delivered activities.

Final commands:

```sh
pnpm --filter bobs-factory-linear-event-transport test:run
pnpm --filter bobs-factory-linear-event-transport typecheck
bun run apps/f1/test-drives/assets/linear-delivery-104-110.ts
```

Results: all 56 Linear tests and type checking pass. The drive reports `PASS`, `unhandled: 0`, and `credentialRotation: {requests: 4, delivered: 3, cooldownMs: 120001}`. Ports remain ephemeral and cleanup completes. Logs are available locally at `/tmp/f1-linear-credential-rotation.log`. The clock is controlled; this is actual SDK/HTTP delivery evidence with mocked agents, not live provider or model validation.
