# Settled ticket ownership and fresh Takeover launch

**Date:** 2026-10-06  
**Revision:** fix/settled-ticket-ownership, based on e5cd5b74, committed with this report  
**Behavior:** Explicitly settled finished runs release ticket ownership, including legacy stopped sessions without launch receipts. Live runners, background work and resumed graphs remain exclusive.

F1 applies because this changes ticket launch admission and session lifecycle.
The isolated drive used the built EdgeWorker, CLI tracker/transport, real Git
worktrees, admission journal, persisted worker state and Factory dashboard APIs.
Its home/repository were under `node_modules/.cache/settled-ticket-drive`; RPC
port 3600 and dashboard port 3630 were separate from the production service.

The Simple runner was deterministic. A fixture removed only its receipt to
simulate a pre-journal session. Takeover retained its ID and permissions but
used one controlled clarification role instead of the production delivery graph.
No native provider execution, remote PR or merge was exercised by this drive.

## Assertions and results

- Started Simple session-1 on DEF-1, removed its launch receipt, then stopped it
  through F1. Its native persisted status was `error` and its runner stopped.
- Before settlement, session-2 was rejected with the original owner's ID.
- Settled session-1 through `PUT /api/runs/session-1/view`, checkpointed and
  gracefully restarted the worker. The settlement persisted, and the stopped
  conversation was not resumed.
- Created a new comment session with `[workflow=takeover]`. Session-3 was accepted
  with `comment-selector` provenance, used the existing DEF-1 worktree, and reached
  its real human-answer checkpoint. Dashboard activity and question were present.
- A competing comment session-4 was rejected with session-3's ID and created no graph.
- Answered through the dashboard. Session-3 completed; native ticket comments
  recorded assistance and completion. Stopped it through F1 and verified its
  receipt became settled. The isolated server was shut down cleanly.

Fixture setup corrections: added the required dashboard request header; used the
CLI tracker's comment-session API because create-comment alone does not launch a
session; asserted Factory's actual ticket completion comment rather than assuming
an SDK response activity. These fixture errors were inspected and corrected;
the changed admission assertions passed without product changes during the drive.

## Checks

- Regression reproduction before the fix: settled legacy, started/recovery receipt
  and failed graph launches were rejected; a completed session with a live runner
  was incorrectly allowed. All six regression cases pass after the fix.
- Five focused suites: **103 tests passed**.
- `pnpm build` and `pnpm typecheck`: passed.
- Changed-file Biome and `git diff --check`: passed.

Fixture source, drive assertions, tracker/worker state and before/after receipts
are retained in `node_modules/.cache/settled-ticket-drive`. Historical test-drive
reports were preserved.
