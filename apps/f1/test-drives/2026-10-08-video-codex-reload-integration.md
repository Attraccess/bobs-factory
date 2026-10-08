# Video evidence and Codex permission reload integration

**Date:** 2026-10-08
**Candidate:** PR #33, head `0b519568`, integrating base `b64db5e9` (PR #50).

The only merge conflict was in `CHANGELOG.md`; both change descriptions were
retained. Codex source changes merged without conflicts. F1 applies to the
inherited runner configuration and its interaction with saved video workflows.

## Executed validation

```sh
F1_AGENT_MODE=mock bun node_modules/.cache/ci-codex-reload/drive.ts
```

An isolated CLI-platform EdgeWorker used fresh Git worktrees, issue-tracker RPC
on port 3681, protected Factory API on 3680 and a one-slot instance capacity
pool. Other roles used simulated agents. Successful capture retries used the
actual Codex runner, app-server backend and process manager with an injected
in-memory transport. No native Codex process or provider credits were used.

The transport parsed actual launch overrides using Python's TOML parser and
asserted complete equality with thread permission definitions. It emitted
scripted command lifecycle and final-result events. Three scenarios passed:

- A failure before thread creation retried without a synthetic session ID.
- A legacy invalid session was cleared only after the missing-thread failure.
- A confirmed session resumed the same thread after worker restart.

All retries retained prior workflow outputs, answers, history, additional visits
and the bytes/hash of recorded video evidence. Git metadata remained writable;
agent settings remained read-only. Tool-use, tool-result and final-result events
were verified in every saved run. Unauthenticated retry requests returned 403.
Final capacity had zero active or queued leases; owned servers stopped cleanly.

Initial driver failures came from inherited capacity settings and an outdated
context argument index. The passing execution used an isolated migration-source
directory and the current context argument layout; product code was unchanged.

Evidence: `/tmp/bobs-codex-reload-f1-lgIeaS`, plus
`ci-codex-reload-f1.log` and `ci-codex-reload-f1-receipts.json` in the run evidence
directory. The driver is retained in `node_modules/.cache/ci-codex-reload/`.

## Other checks and limitations

All 120 Codex runner tests, 11 configuration/activity tests and 132 video/runtime
tests passed. Workspace build, typecheck, changed-source formatting and diff
checks passed. Historical reports remain intact, with trailing whitespace removed
from the newly inherited report.

This drive establishes scripted configuration and recovery behavior. Native
sandbox enforcement, live model behavior, native Safari/iOS, live GitLab APIs,
physical-device notifications and physical passkey ceremonies remain unverified.
Live ticket synchronization remains independently unverified; tracking is owned
by the runtime. Existing optional UI observations are unchanged. Human approval
must apply to the final revision; this drive grants no approval.
