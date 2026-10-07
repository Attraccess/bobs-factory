# Capacity per Cyrus instance

Date: 2026-10-07 (Europe/Berlin). Tested the working tree based on `04f29693`
with the instance-capacity changes. Evidence: `/tmp/cyrus-instance-capacity-jSo5lT`.

## Applicability and scenario

F1 applies to runtime admission and workflow lifecycle. Two real CLI-platform
EdgeWorkers used separate Cyrus homes and repositories, each with a one-slot
limit. Fictional issues selected a controlled script workflow. Each script ran
an ordinary Node command, recorded its execution, then waited for an explicit
release file. Background naming was disabled. No agent CLI or inference API ran.

## Commands and results

- Created fresh repositories with `apps/f1/f1 init-test-repo`.
- Started fixture instances on RPC ports 3600/3601 and UI ports 3540/3541.
- Both inherited the same obsolete `CYRUS_CAPACITY_DIRECTORY`; it was ignored.
- Created and started two issues on A and one on B through the F1 CLI.
- A had one executing step and one queued step. B executed independently:
  `independent-pools.json` records distinct `<home>/machine-capacity` directories,
  A active=1/queued=1 and B active=1/queued=0.
- Execution markers confirmed both admitted steps ran their ordinary command,
  with no extra slot. A's queued step had no execution marker.
- Stopped A's queued session through F1; it never executed after capacity freed.
- Released both admitted scripts. Their runs completed and both pools returned
  to active=0/queued=0.
- Saved B's limit as 2 through its protected settings API. A stayed at 1.
  Restarting B retained 2: `independent-settings.json` and `restart-policy.json`.
- F1 session activities retained coherent acknowledgement/routing entries.
  Factory run receipts recorded execution, queueing, stop and completion.
- Read the built Recipes page through the T3 browser: “Instance capacity”,
  the per-instance explanation, limit and counts were present (`ui-capacity.txt`).
  Preview screenshots failed; this is DOM inspection, not screenshot evidence.

## Checks and cleanup

- 219 targeted tests passed, including instance isolation/restart, coordinator
  recovery, runner admission, workflow/API/PWA and chat coverage.
- Root `pnpm typecheck` and `pnpm build` passed; Biome and diff checks passed.
- Both fixture workers shut down gracefully; their admitted/queued work was
  settled. The temporary browser tab was closed. Production state was untouched.
- This drive validates instance admission with controlled scripts, not native
  provider behavior or the original recommendation feature's four missing checks.
