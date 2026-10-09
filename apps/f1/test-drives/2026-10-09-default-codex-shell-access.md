# Default Codex shell access

Date: 2026-10-09. Tested checkout based on
`57c9ed186c3c1d3aae89eefd26150c1a40c6eb30`, with the uncommitted
full-access default change.

## Failure and scope

Run `manual-9e902b46-ad18-4020-89ba-d5deb0997420` stopped for assistance
after four startup/capacity tests failed because `MachineCapacity.processStart()`
could not spawn `ps`. Native Codex 0.162.0 reproduced the denial on macOS:
`codex sandbox -P :workspace -- /bin/ps -p <pid> -o lstart=` returned
`Operation not permitted`. Native `command/exec` returned exit 71 under
workspace-write and exit 0 under full access for the same command.

F1 applies to the changed runner execution policy. Assertions: omitted mode
permits native process inspection and installed tools; explicit workspace-write
and read-only retain their restrictions; removing an override restores full
access for a new role; issue routing and final response activity still work.

## Drive

```sh
F1_AGENT_MODE=mock bun /tmp/bobs-default-shell-f1.mjs
```

The isolated fixture used the real EdgeWorker, configuration watcher, CLI RPC
on port 3600, linked Git worktrees, shared runner factory, CodexRunner,
AppServerCodexBackend, process manager and activity mapper. Other agent entry
points used `f1AgentHandlers('mock')`. The Codex transport simulated thread and
turn events, while native `command/exec` performed deterministic probes using
the production launch overrides and serialized thread policy. No native model
turn or inference API was invoked.

| Configuration | Issue/session | Native assertions | Activities |
| --- | --- | --- | --- |
| Omitted | DEF-1 / session-1 | `ps`, Git, Node, pnpm and ripgrep succeed; worktree write succeeds | 11 |
| Explicit workspace-write | DEF-2 / session-2 | `ps` denied; worktree write succeeds | 7 |
| Explicit read-only | DEF-3 / session-3 | `ps` and worktree write denied | 6 |
| Field removed after reload | DEF-4 / session-4 | Full access restored; installed tools and worktree write succeed | 11 |

All four workflows completed with timestamped tool activities and final response
activities. Probe files were removed, sessions stopped, and the worker closed
its watcher and listeners. The fresh repository had no origin; expected fetch
warnings fell back to local main.

Receipts, temporary configuration, worktrees and activity snapshots remain at
`/private/var/folders/_r/fld8l71j7ts635hlb5vtgnb80000gn/T/f1-default-shell-VQ4e6Y`.
The passing log is `/tmp/bobs-default-shell-f1.log`. The first fixture attempt
misread the thread protocol's `permissions` field as `permissionProfile`;
the corrected fixture retained all policy assertions. Its failed log is
`/tmp/bobs-default-shell-f1-failed.log`.

## Other checks and limits

- All 137 Codex runner tests and 52 EdgeWorker configuration/selection tests passed.
- Execution-profile checks passed 26 tests, including reserved infrastructure,
  source conflicts and credential binding. The separate OpenPGP signing test
  requires unavailable `gpgconf`; it failed before the relevant-only rerun.
- The original affected worktree's startup/capacity suites passed all 120 tests
  when executed with host access, including the four previously blocked cases.
- Workspace build, type checks, changed-file Biome and schema generation passed.
- The local installation was separately configured with explicit full access,
  with its prior config backed up. A subsequent production role's native turn
  context recorded `danger-full-access`, confirming the reload.
- Native enforcement was checked on macOS. Linux, real model behavior, browser
  rendering and recovery of the original waiting run were not driven. Its
  separate request for an authorized Linear rendering session remains unresolved.
