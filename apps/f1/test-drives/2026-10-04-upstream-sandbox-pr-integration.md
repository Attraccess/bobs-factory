# Upstream sandbox PR integration

Date: 2026-10-04.
Tested tree: local merge `cab4d7f` (PR #1521 head `b5369e2`) with
PR #1516 head `ed5f6ce` merged, before committing the second merge.
The two conflicts were resolved by preserving both changelog entries and both
sets of configuration-schema tests. Runtime sources merged without conflicts.

## Scenario and setup

F1 applies to these runner sandbox configuration changes. Validate their combined
behavior in real Codex issue sessions, including configuration reloads and
visible action/final response activities.

A disposable empty Git repository under the OS temporary directory was used
with F1 on port 3600, `CYRUS_DEFAULT_RUNNER=codex`, and
`CODEX_MODEL=gpt-6.1-sol`. The egress proxy was disabled. An uncommitted temporary
copy of `apps/f1/server.ts` persisted its generated configuration and called
`edgeWorker.setConfigPath(configPath)` to exercise the production watcher.
Two fresh sibling directories under `~/.cyrus-f1-pr-import-qshgd4vf/` were used
for host write probes; only `allowed` was initially configured as writable.
The installed Cyrus service and operator configuration were not changed.

The drive used JSON-RPC `ping`, `status`, `createIssue`, `startSession`,
`promptSession`, `viewSession`, and `stopSession`. Each issue selected
`[agent=codex]` and `[repo=f1-test-repo]`. Python standard-library probes created
and immediately deleted successful file/socket writes.

## Results

| Configuration | Session | Observed behavior | Final response |
| --- | --- | --- | --- |
| Default mode, additional writable directory | session-1 | File creation and Unix socket binding allowed in configured directory; unlisted sibling denied; worktree write allowed | `WRITABLE_ROOT_OK` (activity-7) |
| Read-only, configured directory retained | session-2 | Configured directory and worktree writes both denied | `READ_ONLY_OK` (activity-19) |
| Full access, configured directory retained | session-3 | Write to unlisted host sibling allowed | `FULL_ACCESS_OK` (activity-26) |
| Mode removed, directory list cleared | session-4 | Both host directories denied; worktree write allowed | `RESET_DEFAULT_OK` (activity-33) |

Watcher logs confirmed reloads before the subsequent fresh sessions. All four
sessions contained timestamped, readable actions and final responses. The first
read-only attempt used a shell here-document, which was denied before Python
ran; a follow-up using `python3 -c` completed both intended denial assertions.
All four sessions stopped successfully, the server shut down gracefully, and
the temporary bootstrap and host probe directories were removed.

## Other checks and limits

- 114 targeted tests passed across core schemas, CLI config forwarding,
  configuration reload, runner selection, issue/chat runner configuration,
  Codex policy/backend, and Cursor sandbox plumbing.
- Repository build and type checks passed.
- Generated JSON schemas matched the merged tree; Biome checked 15 changed
  TypeScript/JSON files successfully; `git diff --check` passed.
- Live coverage is macOS Codex issue execution with the egress proxy disabled.
  Claude, Cursor, chat execution, browser startup, and other platforms were not
  driven; their relevant configuration paths retain targeted test coverage.
- The fresh repository had no origin; expected fetch warnings fell back to its
  local `main`. Raw activity snapshots and server logs remain in the disposable
  test directory for local inspection. Historical upstream reports are preserved.
