# Simple startup cancellation during persistence

Date: 2026-10-06. Finding: REVIEW-002, draft PR #13.

Validated source: `ea390e65671c64f999c1c29d4719b8c37ee6d910` plus the
review-fix diff adding the final `ensureTicketLaunchOpen` check before Simple
runner startup. The built worker used a fresh isolated repository and state in
`node_modules/.cache/workflow55-startup-race`, RPC port 3600 and dashboard port
3630. No frontend behavior changed in this revision.

## Scenario and assertions

The fixture ran the actual CLI issue tracker, webhook routing, EdgeWorker launch
admission, session manager and persistence. A deterministic runner fixture and
a one-shot persistence barrier exposed the reviewed interleaving. Unassignment
was dispatched through a fixture endpoint to the real worker handler. These are
controlled F1 deliveries, not additional genuine Linear webhook evidence.

For each of streaming and non-streaming Simple runners:

1. Create an issue with `[workflow=simple] Keep working` and start its session.
2. Pause startup after runner registration, while saving state is awaiting.
3. Unassign the issue. Assert the receipt is settled and the runner is stopped.
4. Release persistence. Assert startup posts `This ticket launch was stopped`,
   never calls either start method and leaves no runner running.
5. Replay the original created webhook. Assert it cannot start work again.
6. Start a distinct assignment. Assert exactly one new runner starts.
7. Unassign again and checkpoint. Assert every receipt is settled and every
   runner is stopped.

Both modes passed. This also confirms the cancellation exception retains settled
ownership instead of reverting the receipt to recovery. The earlier review-fix
and genuine Linear reports remain preserved.

## Commands and evidence

```sh
pnpm --filter cyrus-edge-worker build
apps/f1/f1 init-test-repo --path node_modules/.cache/workflow55-startup-race/repo
bun run node_modules/.cache/workflow55-startup-race/fixture.mjs
apps/f1/f1 ping
apps/f1/f1 status
node node_modules/.cache/workflow55-startup-race/drive.mjs
pnpm --filter cyrus-edge-worker exec vitest run test/EdgeWorker.workflow-triggers.test.ts
pnpm --filter cyrus-edge-worker test:run
```

The launch-boundary suite passed all 30 tests, including two regression cases
that failed on the previous source by calling start after unassignment. Fixture
source, drive assertions, receipt/activity snapshots, build and worker-suite
logs are preserved with the `startup-race-` prefix in
`/Users/jappy/.cyrus/factory/evidence/manual-8321a0ae-7e34-46fc-a622-0acb59021b79`.
The isolated fixture was stopped after validation.
