# Factory operator MCP recovery

The isolated MCP recovery scenario passed with simulated agents. An external MCP
client repaired a missing Taskbot connection and retried the same run through
setup to completion. After resuming with process access and GnuPG, all affected
worker checks and full native startup/restart validation passed.

## Revision and setup

Base revision: `985ef48c659714dd06a393325817e0ec7c2ccfb5`, with uncommitted changes.
The SHA-256 digest of sorted changed paths and their bytes, separated by NULs,
excluding test-drive reports, is
`ff54cbe8f278eb6ba9d6f3e152c8e7cd1ca8e400fa9d2e29ad78b17084b9a54e`.

Authentication, tracker transport, configuration and recovery changes make F1
applicable under `skills/f1-test-drive/SKILL.md`. The embedded fixture starts a
real EdgeWorker with its own home, Git repository and local bare remote. It sets
`F1_AGENT_MODE=mock` and injects `f1AgentHandlers("mock", ...)`. Direct MCP and
native Codex adapters return synthetic responses. No production ticket, provider
inference, native OAuth login, publication or historical run is used.

The first visit simulated OS process identity because the sandbox denied `ps`.
On resume, that simulation was removed and the same recovery scenario passed
with real process inspection. Worker, configuration watcher, runtime, SDK and
stdio bridge are real; agents and tracker responses remain simulated.

## Assertions and results

- Actual MCP SDK discovery and calls traverse the compiled Node CLI stdio bridge
  and separate authenticated loopback listener without starting another worker.
- The initial Taskbot URL fails setup with missing transport. Inspection identifies
  the retained OpenCode runner even before setup has established a ticket reference.
- MCP connection repair saves the endpoint and exact permissions for `get_ticket`,
  `set_status`, `comment` and `add_attachment`. Worker reload reports applied.
- A simulated direct HTTP 401 is classified as missing authentication. Provider
  error contents are withheld, retry is rejected before setup, and Codex is not used.
- After a successful read-only `get_ticket`, retry advances the same run through
  setup and the simulated work step. The retained runner remains OpenCode.
- Companion SDK/runtime cases cover independent scopes, durable revocation,
  wrong-instance rejection, stale and parallel operations, current question batches,
  explanation requests, disabled steering, pagination and credential redaction.
- Interrupted continuation and failed-run retry preserve completed outputs,
  checkpoint evidence, publication receipts and approvals. Tracking-only retry
  calls synchronization without replaying agents. Operator tools cannot approve review.
- Configuration checks cover stale edits, deny precedence, unrelated-field
  preservation, failed reload reporting, and saved profile updates for future
  launches without replacing frozen run selection.
- Local-launch tests verify that repaired connection permissions survive restart
  and a different repository cannot reuse that home's retained identity.

## Commands and evidence

```sh
pnpm --filter 'bobs-factory...' build
pnpm --filter bobs-factory-mcp-tools exec vitest run --maxWorkers=1 --testTimeout=30000
pnpm --filter bobs-factory-edge-worker typecheck
pnpm --filter bobs-factory-mcp-tools typecheck
pnpm --filter bobs-factory typecheck
pnpm --filter bobs-factory-edge-worker exec vitest run test/FactoryServer.test.ts test/WorkflowRuntime.test.ts test/ExecutionProfiles.test.ts test/EdgeWorker.factory-mcp-oauth.test.ts --maxWorkers=1
pnpm --filter bobs-factory exec vitest run app.test.ts src/local.test.ts src/services/WorkerService.test.ts --maxWorkers=1
F1_AGENT_MODE=mock pnpm --filter bobs-factory-mcp-tools exec vitest run test/factory-operator-recovery.f1.test.ts --maxWorkers=1 --testTimeout=30000
BOBS_FACTORY_SMOKE_PORT=43972 bash scripts/smoke-binary.sh /private/tmp/factory-operator-binary/bobs-factory-0.2.73-darwin-arm64/bobs-factory
```

CLI tests ran with inherited `BOBS_FACTORY_*` variables removed from their child
environment so instance runner/model overrides did not contaminate configuration
forwarding assertions. MCP suite: 55 passing tests in 10 files, including this
F1 scenario. CLI selection: 33 passing tests. Changed TypeScript files passed
Biome; package typechecks, build and `git diff --check` passed.

An isolated Bun 1.4.2 executable built the native darwin-arm64 candidate with
`scripts/build-binary.ts`. Owner grant/list/revoke commands passed, the client
file was 0600, and output contained no token/hash. Setting
`BOBS_FACTORY_OPERATOR_SMOKE_EXECUTABLE` to that candidate and rerunning
`factory-operator.integration.test.ts` passed all eight tests, including native
MCP stdio discovery/call/revocation. The full native smoke also passed on resume:
two worker startups, shell/assets, unauthenticated API 401, authenticated API 200,
MCP context pagination, clean shutdown and restart. Its child environment excluded
inherited `BOBS_FACTORY_*` overrides except the selected isolated smoke port.

## Resumed verification and limitations

The first affected-worker selection had 162 passing and five blocked tests:
four capacity/settings cases failed because `ps` was denied; the private OpenPGP
case failed because GnuPG was absent. Process access was restored and GnuPG
2.5.24 installed. The resumed selection passed all 167 tests across four files,
including actual isolated OpenPGP signing and verification. No test was skipped
or waived, and the production process/signing code needed no changes.

A protected dashboard fixture rejected the operator bearer with HTTP 401.
Headless Chrome initially could not start under the sandbox, then started on
resume. The isolated dashboard still requires passkey access; the inspected
screenshot is `operator-dashboard-passkey.png` in the run evidence directory.
The fixture trusts both loopback hostnames because the browser uses localhost.
No setup UI changed and no physical passkey ceremony is claimed. Real native
OAuth and real agents remain untested; provider-credit validation was not
authorized. No PR, deployment or merge was performed.

Sanitized command logs are retained in the run evidence directory under
`operator-mcp-final.log`, `operator-native-smoke.log`, `operator-cli-final.log`,
`operator-edge-final.log` and the associated build/typecheck/lint logs. Resumed
results are `operator-edge-unblocked.log`, `operator-f1-real-process.log`,
`operator-native-full-smoke-isolated.log` and `operator-lint-resumed.log`.
