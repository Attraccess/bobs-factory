# Factory Web Push lifecycle review fixes

Date: 2026-10-07. Tested `20b49f1de8c1a22bca3cc92cd3699a8674009e41`
plus the WP-001/WP-002 fixes in `PushEvents.ts` and `EdgeWorker.ts`.
PR: [#35](https://github.com/Attraccess/bobs-factory/pull/35), kept draft.

F1 applies because these fixes change restart attention and native-session
notification eligibility. This scoped drive preserves the earlier implementation
report and exercises the two review findings with the compiled EdgeWorker,
CLI issue tracker, protected Factory APIs and actual persisted WorkflowRuntime.
Deterministic agent/tool results and an injected sender avoid launching harness
agents or changing production tickets, PRs or approvals.

## Reproduction and assertions

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-56a8faa8-c83d-4083-a81b-b98174357df8`.
The driver, activity snapshot, seven notification receipts and worker log are
saved as `push-review-fix-drive.mjs`, `push-review-fix-activities.json`,
`push-review-fix-results.json` and `push-review-fix-worker.log`.

```sh
pnpm --filter cyrus-edge-worker build
apps/f1/f1 init-test-repo --path /tmp/factory-push-review-fix-74357df8
node <evidence-directory>/push-review-fix-drive.mjs
```

Node ran the fixture on loopback UI port 3597 and F1 RPC port 3600 with a fresh
temporary worker home and isolated test repository. The driver used F1 RPC to
create/start two ticket-backed runs and capture activities, and protected Factory
APIs to register a device, answer questions and reject a fixture review.

- Question and review waits each initially produced one notification.
- Worker restart retained the VAPID key, identical pending questions/gate and
  both receipts. Ticket preparation and restored waiting produced no replay.
- Answering the question and rejecting the gate each produced one fresh alert
  for the next question wave/new gate.
- Actual `AgentSessionManager.completeSession` transitions produced native chat
  and GitHub completion alerts and a GitLab failure alert while retaining saved
  execution input. No runner or external integration execution was launched.
- Active statuses, ordinary title saves and an intentional stop produced no
  alert. A second worker restart did not replay native terminal events.
- All ten assertions passed, with seven total sender receipts. The worker was
  stopped cleanly, including its listeners and local servers.

## Regression coverage and limitations

The push-service suite adds real-runtime question/gate restart regressions and
checks that new attention still delivers after a human response. Both tests
failed with the pre-fix classifier restored, then passed with the fix.

This drive records sender acceptance, not real-device/background delivery.
Physical devices and the protected HTTPS/tailnet deployment remain unverified;
the prior report's browser evidence and limited security exception remain valid.
No dependencies or UI assets changed in this fix. Tracker synchronization remains
runtime-owned; the supplied ticket snapshot discrepancy remains a limitation.
