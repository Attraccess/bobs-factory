# F1 drive: delivery with failing repository commit hooks

**Date:** 2026-10-09
**Tested commit:** `3e117128f77ecf256b1f7866f65906b33c83e9fb` ([#59](https://github.com/jappyjan/bobs-factory/pull/59))
**Changed behavior:** Factory's mechanical draft-PR commit skips repository pre-commit and commit-msg hooks; push hooks remain enabled.

## Scenario and assertions

This is applicable Factory runtime delivery behavior. A controlled embedded
`WorkflowRuntime` executes the real `FactoryTools` draft-PR step against a fresh
Git repository and a local bare remote. GitHub responses are scripted. No native
agent or provider inference runs; no issue-tracker routing or passkey ceremony is
claimed by this focused drive.

The fixture installs failing pre-commit and commit-msg hooks plus a pre-push hook
that records its execution. Before launching the workflow, a normal Git commit
fails with `F1 commit hook refuses delivery`. The workflow then commits the same
staged change, pushes it, and records the scripted draft PR receipt.

- Passed: normal commit reproduces the original hook failure.
- Passed: workflow completes with a real commit and push to the local remote.
- Passed: remote branch SHA equals the local commit SHA.
- Passed: pre-push sentinel proves push hooks remain active.
- Passed: draft PR output, workflow history, and delivery events are retained.
- Passed: native agent invocation count is zero.

## Execution evidence

```sh
node /tmp/f1-fix59-delivery.mjs
```

Fixture root: `/tmp/f1-fix59-delivery-NQjLMl`.
Receipt: `/tmp/f1-fix59-delivery-receipt.json`.
Result at `2026-10-09T08:49:25.856Z`: `status=completed`, `nativeCalls=0`.
Runtime was shut down after assertions; no background fixture worker remains.

Related validation: FactoryPipeline, GitProvider, DeliveryCoordination and
CISupervision suites passed (96 tests), and edge-worker type checking passed.
Binary candidate workflow `37906510201` passed on all four native targets.
The installed darwin-arm64 candidate also passed startup, protected API, scoped
MCP, shutdown, and restart smoke locally with OS tools on PATH.

```sh
env BOBS_FACTORY_SMOKE_PORT=4437 PATH=/usr/bin:/bin:/usr/sbin:/sbin \
  ./scripts/smoke-binary.sh /tmp/bobs-factory-fix59-nix/bin/bobs-factory
```

An initial smoke attempt with the host's mixed Nix/Homebrew PATH failed at the
fixture's authenticated API check (401); using the prescribed OS tools passed.
This drive does not establish that arbitrary repository hooks are safe to skip
outside Factory's delivery commit or replace implementation checks and CI.

## Installed recovery

The existing service was stopped, mutable state and its LaunchAgent backed up,
and the verified candidate installed through the existing Nix archive installer.
The service and user CLI retain `/Users/jappy/.cyrus`; native conversations and
worktree paths were preserved. `/api/version` confirmed the tested commit with
`dirty=false` and `packaged=true` after restart.

Run `09703dc8-c61f-4713-91a7-b5766205bbb2` was retried through
`WorkflowRuntime.retry` while the service was stopped, parked before any role or
tool execution, then resumed by ordinary startup. Assertions preserved its
history, outputs, answers, workspace, pinned workflow definitions, and exact
checkpoint. It entered the normal delivery queue and was admitted to the saved
`pipeline/draft-pr` step; later review and CI remain the run's own gates.
