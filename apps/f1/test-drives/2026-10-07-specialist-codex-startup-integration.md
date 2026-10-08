# Specialist review integration with Codex startup recovery

Date: 2026-10-07. Tested the merge working tree of specialist PR #32 head
`7bed3c46` and main `0de51ccf` (Codex startup recovery, PR #40).
Only the changelog conflicted; both entries were retained. Runtime and test
changes merged without manual edits. Previous SR-001 through SR-004 and
QA-001/QA-002 dispositions and historical evidence remain retained.

## Applicability and setup

F1 applies to the incoming runner/session lifecycle and persisted Factory retry
behavior. The adapted startup driver uses this worktree's freshly built packages,
a fresh Git repository and Cyrus home, F1 RPC on 3956 and Factory HTTP on 3955.
Every agent is intercepted: scripted Codex backends inject errors and ordinary
roles use MockAgentRunner. Background titles are disabled. The instance capacity
is one. No native agent, paid inference, real tracker or GitHub mutation occurs.

Evidence root:
`/Users/jappy/.cyrus/factory/evidence/manual-0b7cf77f-8296-4e61-9df5-b03561e59729/ci-r5`.
`merge.patch` records the tested merge before this report. `startup-drive.ts`
is adapted from the PR #40 fixture, changing only worktree/evidence paths and
loopback ports. The fixture's nested graph exercises clarification, QA scope,
capture, QA review and QA gate using ordinary production contracts.

```sh
F1_AGENT_MODE=mock CYRUS_DISABLE_REMOTE_SESSION_STORE=1 bun EVIDENCE_DIR/startup-drive.ts
pnpm --filter cyrus-codex-runner test:run
pnpm --filter cyrus-edge-worker exec vitest run test/WorkflowRuntime.test.ts test/SpecialistReview.test.ts test/EdgeWorker.capture-recovery.test.ts test/AgentSessionManager.codex-runner-activity.test.ts test/FactoryServer.test.ts test/FactoryPipeline.test.ts test/Guide.test.ts test/TicketTracking.test.ts
pnpm build
pnpm typecheck
pnpm biome ci
```

## Results

The driver printed `F1_STARTUP_RECOVERY_PASS`. All three issue/session scenarios
completed after worker restart and protected HTTP Retry:

- Initialization failed before thread creation: both attempts omitted a resume
  ID; no nonexistent conversation checkpoint was saved.
- A legacy synthetic ID failed to resume: only the proven invalid agent
  checkpoint was removed. Attempts used no ID, the synthetic ID, then no ID.
- A confirmed thread failed during its turn: retry retained its genuine ID.

Each scenario retained exact completed clarification/scope receipts and executed
those roles once. Capture remained at pass one. QA gates approved fixture
results. F1 activity output and the paged Factory activity endpoint were checked.
All agent results reported zero provider cost. Final capacity had zero active or
queued requests and the worker stopped cleanly. Receipts and complete run records
are in `startup-EusBU7`; the log is `startup-drive.log`.

84 Codex tests and 235 Factory tests passed. These include nested/fanout startup
recovery, unsafe-checkpoint preservation, specialist requirements/history,
coverage, guides, approval, feedback and tracking regression checks. Root build
and typecheck passed. No frontend code changed, so no new browser capture was
needed. Existing screenshots retain their historical revision provenance.

This establishes orchestration and persistence with simulated agents. It does
not establish real-model extraction/review quality, native startup reliability
or live-provider continuation. Historical capacity-lock and iteration-limit
incidents remain recorded; supplied tracking receipts are delivered. The PR
remains draft and requires fresh review/approval for the integrated revision.
