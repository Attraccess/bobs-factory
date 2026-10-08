# Factory Web Push pending-work completion fix

Date: 2026-10-07. Tested `fa42edc32fc3a70732d88f2f623bce430a634efc`
plus the WP-003 changes in `EdgeWorker.ts` and `PushEvents.ts`.
PR: [#35](https://github.com/Attraccess/bobs-factory/pull/35), kept draft.

F1 applies because this fix changes native-session notification eligibility.
This scoped drive uses the compiled EdgeWorker's actual push observer,
AgentSessionManager completion path, F1 CLI issue tracker and protected Factory
device API. Deterministic runner pending-work snapshots and an injected sender
avoid launching agents or changing production tickets, PRs or approvals.

## Commands and evidence

```sh
pnpm --filter cyrus-edge-worker build
apps/f1/f1 init-test-repo --path /tmp/factory-push-pending-work-74357df8
node <evidence-directory>/push-pending-work-drive.mjs
```

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-56a8faa8-c83d-4083-a81b-b98174357df8`.
The driver, activity snapshot, five notification receipts and worker log are
`push-pending-work-drive.mjs`, `push-pending-work-activities.json`,
`push-pending-work-results.json` and `push-pending-work-worker.log`.

The drive ran on loopback Factory port 3597 and F1 RPC port 3600 with a fresh
temporary worker home and test repository. It created and started a ticket-backed
question fixture through F1 RPC, captured activities, registered a device through
the protected API and stopped the fixture before testing native completions.

## Results

- The issue/session/activity path produced its expected question receipt.
- A successful native turn with a pending CI-check wakeup produced no completion
  receipt while the runner remained open.
- A successful native turn with an in-flight background task also produced none.
- Each session delivered one completion after its work cleared and the final
  result arrived. Ordinary title saves did not repeat either notification.
- A runner without pending-work reporting still delivered completion, including
  when saved execution input remained present.
- A failed native turn delivered its failure alert despite a pending wakeup.
- All six assertions passed; the worker and local servers stopped cleanly.

The automated push regression also checks intermediate suppression, final
delivery, deduplication and failure eligibility. Existing restart-attention and
retained-input protections remain covered by the focused suites and prior drive.

## Limitations

Sender acceptance is not physical-device or background-delivery evidence.
Physical devices and protected HTTPS/tailnet deployment remain unverified.
The accepted exception for two existing dependency advisories and the supplied
tracker snapshot discrepancy remain limitations. No dependencies or UI changed.
