# Codex startup cancellation and installed-binary shutdown

**Date:** 2026-10-07  
**Finding:** BF38-QA-003  
**Tested code:** `15d89b78fd5d37ce6c9d196fd006966c83d4b822`

Stopping a retried Simple run previously allowed Codex startup to continue after
Stop. A process acquired after backend cleanup could retain the execution lease
and prevent worker shutdown for more than 120 seconds. Configuration also
performed asynchronous login/model checks before entering runner finalization.

The runner now cancels configuration and prevents subsequent backend startup.
Backend cancellation covers process acquisition, thread setup and turn startup.
Failed initialization closes its client. Concurrent cleanup awaits the same
release, and cancellation preserves other leases on a shared process. A late
turn-start response receives an interrupt instead of restoring cancelled state.

## Applicable validation

This changes agent startup and termination, so F1 applies. Every drive used
`F1_AGENT_MODE=mock`, scripted Codex JSON-RPC, or injected simulated runners.
No provider credits or real-agent authentication were used. The installed
candidate was built from clean code and installed outside the checkout.

Commands from the repository root:

```sh
pnpm --filter bobs-factory-codex-runner test:run
pnpm --filter bobs-factory-edge-worker test:run test/MachineCapacity.test.ts test/EdgeWorker.instance-capacity.test.ts test/WorkflowRuntime.test.ts
pnpm build
pnpm typecheck
pnpm exec biome check packages/codex-runner
bun run scripts/build-binary.ts --target darwin-arm64 --output /tmp/bf38-stop-15d89b78
scripts/install-binary.sh /tmp/bf38-stop-15d89b78/bobs-factory-0.2.73-darwin-arm64.tar.gz /tmp/bf38-stop-15d89b78/bobs-factory-0.2.73-darwin-arm64.manifest.json /tmp/bf38-stop-15d89b78-prefix
```

The evidence directory is
`/Users/jappy/.cyrus/factory/evidence/manual-7f0c7c6e-cca1-4387-b7ee-7d81e06997ba`.
Its `qa-stop-fix-seed.mjs`, `qa-stop-fix-drive.py` and
`qa-stop-fix-standard-f1.ts` retain the executed harnesses. Run:

```sh
F1_AGENT_MODE=mock python3 "$evidence/qa-stop-fix-drive.py" /tmp/bf38-stop-15d89b78-prefix/bin/bobs-factory
F1_AGENT_MODE=mock bun "$evidence/qa-stop-fix-standard-f1.ts"
```

Set `evidence` to the directory above. The native harness creates a fresh home,
repository and prepared scripted launcher. Its worker PATH contains only that
launcher and operating-system tools. Legacy capacity discovery points to an
isolated fixture. Host state and credentials are not changed.

## Results

- All 89 Codex tests passed, including cancellation during a pending configuration
  build, scripted login-status probe, simulated model fetch, shared initialization,
  thread start/resume and delayed turn startup. Other leases remained usable.
- All 98 capacity and workflow tests passed. Build, typecheck, Biome and diff
  checks passed.
- Installed-binary Retry → Stop passed immediately and during initialization,
  thread start, thread resume, turn start and an active turn. Every scripted child
  exited; each run remained stopped and capacity returned to zero. The slowest
  observed release was 2.28 seconds.
- Stop → immediate SIGTERM during initialization exited successfully in 0.24
  seconds. Both listeners closed and persisted capacity contained no requests.
  Two further shutdowns also closed both ports with empty persisted capacity.
- Restart retained stopped runs without replay. A separately retried simulated
  run completed and produced the expected response activity.
- Standard F1 issue/session creation, mocked Codex selection and response activity
  passed. No unhandled or fatal errors appeared in the successful worker logs.

Receipts: `qa-stop-fix-receipts.json`, `qa-stop-fix-binary-build.json`,
`qa-stop-fix-standard-session.json`, and corresponding build/test/worker logs.
Initial harness setup failures were corrected: isolate legacy capacity discovery,
send the required mutation header, and expect the runtime's `completed` status.
The successful receipts cover the final code; earlier failed attempts are not
passing product evidence.

## Limitations retained

This establishes lifecycle behavior with simulated agents, not real-agent
reasoning or provider continuation. Existing native Intel, authenticated Cursor,
platform compatibility and publication licensing limits remain. Live ticket
synchronization and the external hosted MCP catalog remain unverified. The prior
limited dependency-security exception is unchanged. Earlier accepted fixes and
visual states are retained; this correction changes no dashboard rendering.
