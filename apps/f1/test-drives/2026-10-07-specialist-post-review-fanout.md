# Specialist review association in subsequent fanout

Date: 2026-10-07. Tested clean base `76939376450c2403b6dff24fa2b8b4317fa31f92` plus the SR-002 follow-up fix in draft PR [#32](https://github.com/Attraccess/bobs-factory/pull/32).

F1 applies to the workflow runtime change: fanout branches after a nested review must inherit the accepted review association. This delta drive uses `F1_AGENT_MODE=mock` and injected deterministic agent attempts through the compiled EdgeWorker, production output finalization/correction, real CLI tracker/RPC, configured workflows and persisted runtime. It exercises no live model inference, production ticket mutation, publication, human approval or merge.

## Scenarios and assertions

- **Valid branch guide and called QA:** DEF-1/session-1 completes child extraction and six specialist reviews with the renamed `aggregate-review` gate. The parent then runs a two-group fanout. Both branches inherit `child/specialist-review`; one calls a separate QA workflow and generates a guide. Production QA accepts stable R1 references and the guide contains authoritative R1 coverage and six reviewer receipts. A real FactoryTools human-review invocation in the branch, with controlled readiness receipts, rejects a changed local head. The run waits at the parent human-review checkpoint; no approval is submitted.
- **Unrelated guide requirement:** DEF-2/session-2 repeats the same nested-review → parent-fanout layout but substitutes `unrelated` for accepted R1. Production validation rejects both attempts with “Guide requirements must match every active frozen inventory ID and criterion in inventory order”. The run fails at `post-review/0/guide`, with no accepted guide output or subsequent approval step.
- **Restart:** Graceful shutdown and restart retain both runs' status, current step, error, histories, outputs, review rounds and checkpoints exactly. Completed review branches are not replayed.
- **Focused regression:** The new post-review-fanout test fails with the association-inheritance lines removed and passes with the fix. Separate restoration cases fill a missing persisted branch association and preserve a branch's own established review without replaying completed reviewers.

## Commands and evidence

```sh
pnpm build
F1_AGENT_MODE=mock node <evidence-directory>/fanout-review73.mjs
CYRUS_PORT=3894 apps/f1/f1 ping
CYRUS_PORT=3894 apps/f1/f1 create-issue --title 'Post-review fanout provenance' --description '<accepted null-input criterion and fanout scenario>' --labels workflow:fanout73
CYRUS_PORT=3894 apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3894 apps/f1/f1 create-issue --title 'Reject unrelated fanout guide requirement' --description 'bad-guide: <accepted null-input criterion>' --labels workflow:fanout73
CYRUS_PORT=3894 apps/f1/f1 start-session --issue-id issue-2
CYRUS_PORT=3894 apps/f1/f1 view-session --session-id session-1 --limit 8 --offset 0
```

Isolated home: `/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/fanout73-home-QtSCdH`. Repository: `/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/fanout73-repo-jnezHB`. Dashboard/RPC ports: 3893/3894. Capacity uses a separate pool. Both worker processes were stopped after validation.

Evidence directory: `/Users/jappy/.cyrus/factory/evidence/manual-0b7cf77f-8296-4e61-9df5-b03561e59729`. Retained fixture `fanout-review73.mjs`, checks `fanout-review73-checks.json`, `fanout-review73-approval.json`, `fanout-review73-restart-checks.json`, before/after observations, and `fanout-review73-before-fix.log`. The RPC tracker activity list contains routing/start messages; branch steps and correction failures are evidenced by persisted Factory history/checkpoints, rather than claimed as live provider tool events.

162 focused tests passed in SpecialistReview, WorkflowRuntime, FactoryPipeline, Incremental, Guide and MergeReadiness. Root build, lint, typecheck and whitespace checks passed. Lint retains existing warnings. No dependency or UI code changes. Historical F1 evidence remains unchanged; no new browser screenshot is needed for this runtime-only delta. Remote CI and live-provider publication were not exercised. Runtime tracking retains ownership of the originating ticket; supplied lifecycle receipts are delivered and its last recorded status is in progress.
