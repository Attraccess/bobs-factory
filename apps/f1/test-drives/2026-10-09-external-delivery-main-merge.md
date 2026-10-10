# External delivery after merging main

Date: 2026-10-09. [Taskbot 95](https://taskbot.apps.janjaap.de/p/bobs-factory/t/95), [draft PR #80](https://github.com/JappyJan/bobs-factory/pull/80).

Merged base `4d0ffd783d1510edd796ec220688695e6fb17b6d` into head `cbedf10173340dc77d89786a4fb963c5901ce562`, with working conflict resolutions and the background tracking fix. The exact tested files are recorded in `merge-f1/tested-source.json`; receipt digest: `00cc2a7ab7c47a5b3e497a5c8675c015a4093962cc522db2b6aa743c0ec665d8`.

## Behavior and results

F1 applies to the merged workflow and tracking behavior. A fresh isolated EdgeWorker used simulated agents, configured Taskbot HTTPS requests and synthetic repository merge receipts. Six assertions passed:

1. Cross-target blockers reconcile both endpoints and pass independent verification.
2. External work completes only after acceptance of the verified digest.
3. Repeated conflicted retries, including restart, preserve the intervening edit without dispatching a write.
4. Mixed feedback renews the reviewed contract, corrects ticket content and resumes retained repository work.
5. Grouped reacceptance binds a fresh digest and both confirmed repository revisions.
6. Human API acceptance completes mixed proof and asynchronous ticket closure without task replay.

The initial drive exposed a real integration race: background ticket tracking temporarily removed final proof during rereads, allowing graph completion to fail. Background rereads now retain existing proof while pending and invalidate it on drift or failed reads. A focused regression test verifies all three cases.

The fixture also needed two environment/compatibility corrections: unset the installed binary's `BOBS_FACTORY_INTERNAL_EXECUTABLE` when running source code under Bun, and implement the current Taskbot `add_attachment` tool. The driver waits for asynchronous tracking before asserting Done. Final execution was a fresh run, ending `MERGE_F1_PASS 6`.

## Commands and evidence

Evidence: `/Users/jappy/.bobs-factory/factory/evidence/manual-974e31ba-750c-4015-8170-e3856b56c26c/merge-f1`, including fixture/driver scripts, results, final state and source fingerprints.

```sh
env -u BOBS_FACTORY_INTERNAL_EXECUTABLE F1_AGENT_MODE=mock BOBS_FACTORY_DISABLE_REMOTE_SESSION_STORE=1 BOBS_FACTORY_FACTORY_PORT=46995 NODE_EXTRA_CA_CERTS="$EVIDENCE/cert.pem" bun run "$EVIDENCE/fixture.ts" "$EVIDENCE"
node "$EVIDENCE/drive.mjs" "$EVIDENCE"
```

`EVIDENCE` denotes that directory. The fixture stopped its isolated worker and tracker/control servers after the final drive.

Supporting checks: full repository build and typecheck; 265 edge-worker tests across delivery, tracking, workflow, repository scope, server and recovery; 21 Linear adapter/delivery tests; 53 delivery/tracking tests after the race fix, including the new regression. Changed-file Biome and whitespace checks passed.

## Limits

No real agents, production trackers or actual forge publication/merge were exercised. No provider credits were used. Human acceptance used the authenticated API; no UI behavior changed in this merge fix, and earlier browser evidence remains historical. The fixture's forge receipts do not establish production delivery. Providers without conditional writes still have the documented read/write race.
