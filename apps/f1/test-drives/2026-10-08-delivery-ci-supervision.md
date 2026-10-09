# Delivery coordination and CI supervision

Date: 2026-10-08. Tested checkout: `61b0a608eef140149272d34b299a7b61a3a59999`
with the uncommitted factory improvement changes applied. This is a development
build; the provenance API correctly reports its executable source identity as
unknown rather than assigning the checkout commit to a packaged executable.

F1 applies because the changes affect delivery admission, readiness routing,
provider retries and saved assistance waits. The deterministic fixture uses the
authenticated Factory API, real `WorkflowRuntime`, real `FactoryTools`, actual
Git worktrees and a local bare origin. Native agent roles and the external `gh`
transport are scripted. No paid model, live forge or issue-tracker mutation runs.

## Execution

```sh
pnpm --filter bobs-factory-edge-worker build
F1_AGENT_MODE=mock F1_EVIDENCE_DIR=/tmp/f1-delivery-ci-20261008-mixed-final \
  bun apps/f1/test-drives/assets/factory-delivery-ci-supervision.mjs
pnpm --filter bobs-factory-edge-worker exec vitest run \
  test/DeliveryCoordination.test.ts test/CISupervision.test.ts \
  test/WorkflowRuntime.test.ts test/MergeReadiness.test.ts \
  test/GitProvider.test.ts test/FactoryAttemptOutcomes.test.ts \
  test/FactoryProvenance.test.ts test/ReviewRecovery.test.ts \
  test/ReviewSessionContinuity.test.ts
```

The worker build passed. The final API drive passed with **12 recorded snapshots,
13 scripted agent visits, 92 provider transport calls, 49 native Git transport
calls and zero paid calls**. The nine focused Vitest files passed **222 tests**.

The fixture creates its authenticated fixture session through the shared test
server and uses Fastify injection, so it opens no listening port. Runs are
started, inspected, answered and stopped through the protected API. Restart
scenarios reconstruct the runtime and server from their persisted state.

## Results

| Scenario | Observed behavior |
| --- | --- |
| Overlapping delivery | Both runs implemented while the first held finalization. The second queued without publishing, capturing or authoring its guide. |
| Current base integration | A scripted external repository event advanced `main` after the first handoff. The second integrated that base once, retained the required second code review, and performed capture and guide once each. Both actual handoff tools published their guides. |
| Proven infrastructure failure | One current-head Actions retry ran under runtime supervision. Its queued/running attempt coexisted with the previous failed check context; no CI agent ran. |
| Unknown code failure | A concrete assertion failure entered the diagnosis agent once. No infrastructure retry was issued for that failure. |
| Source blocker with infrastructure assistance | A conflicting PR also had an infrastructure failure without a safe retry identity. The configured fixer committed and pushed a real isolated source correction once. It then waited for CI assistance with the failed check and `approved: false` retained; no retry POST or second agent visit occurred. |
| PR title correction | One agent changed the title. The pinned workflow read live PR metadata, permitting a current-SHA rerun. HEAD stayed unchanged and runtime metadata correction issued no Git commit or push. |
| Retry exhaustion | Two provider retries exhausted the bounded budget, then the API showed an assistance wait. Restart retained both receipts and issued no third request or agent visit. |
| Ambiguous retry outcome | A connection reset after the scripted provider accepted a request retained an uncertain receipt. Restart and an explicit assistance answer did not resend the POST. Only fresh passing provider checks permitted completion. |
| Pending checks and cancellation | The run retained a `waiting-ci` leaf without a capacity request, and started no agent. API cancellation stopped the wait cleanly. |

The queue assertions measure actual capture/guide visit counts; they do not claim
production time or cost savings. A consequential integration still caused review.
The explicit base-change receipt, same-time fairness, repository aliases,
native common Git directories, stale-owner re-admission, cancellation and long
provider-wait release are also covered through public runtime/tool tests.

Two additional public provider regressions cover enterprise GitHub: API GET/POST
requests stay pinned to their configured host, while the native Git workflow probe
receives no provider CLI flag. Another public runtime regression confirms that
running retries keep old failures factual and refresh failure evidence when the
new attempt completes. Unchanged check payloads are read once per provider
attempt/lifecycle rather than on every readiness poll.

Two public runtime regressions first failed because CI assistance preempted the
configured correction branch. They now cover both unsupported and exhausted
infrastructure retries alongside a concrete merge conflict, preserving failed
checks and all existing retry receipts while the actionable correction runs.
The API drive additionally verifies the actual isolated Git commit and push.

## Parallel publication addendum

The independent review reproduced a custom-workflow bypass: a publication
fanout started its children before delivery admission, allowing a second run's
provider side effects to overtake an active first delivery. Two public runtime
regressions failed before the fix and passed after admission moved to the
containing fanout boundary. The cases cover a direct provider child and a child
that calls a frozen workflow definition, while both implementation fanouts
continue concurrently. The complete coordination file passed 11 tests.

```sh
F1_AGENT_MODE=mock F1_EVIDENCE_DIR=/tmp/f1-delivery-fanout-20261008 \
  bun apps/f1/test-drives/assets/factory-delivery-fanout.mjs
```

The [focused fixture](assets/factory-delivery-fanout.mjs) passed through the
authenticated Factory API with two scenarios, eight scripted role visits,
eight scripted provider/tool calls, zero paid calls and no listening port.
For each configuration, both implementations finished while the first
publication was held; the second publication queued and made no provider
call until the first publication and handoff completed. Its temporary homes
were removed after shutdown. Raw receipts are saved in
`/tmp/f1-delivery-fanout-20261008/factory-delivery-fanout.json`.
This focused replay controls agent and tool/provider hooks to validate admission
and saved workflow execution. The original drive above retains the separate
actual FactoryTools/native Git evidence.

## Evidence and limits

Raw receipts: `/tmp/f1-delivery-ci-20261008-mixed-final/factory-delivery-ci-supervision.json`.
The isolated repository and saved runs remain under
`/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/f1-delivery-ci-supervision-aVnBED/`.
The JSON records role visits, provider/native Git calls, outputs, coordination,
retry receipts and the secret-safe provenance export.

The custom delivery workflow ends after actual handoff publication. Its capture,
reviewer and guide outputs are explicitly scripted and claim no real screenshots
or model assessment. Production human approval, merge and specialist/QA contracts
remain enforced and are covered by the relevant runtime/provider tests and the
separate review/context drive. This drive does not validate live GitHub/GitLab,
tracker delivery, a packaged binary, browser rendering or paid runner behavior.
GitLab retries have focused current-head/provider-reason contract coverage; the
native Actions scenarios here exercise GitHub only.
