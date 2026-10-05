# Factory UI responsiveness during activity bursts

Date: 2026-10-05
Tested runtime: `a375719fc1dde59b2b4eadf97dc2759aa16eeb21`

The activity persistence change affects the live EdgeWorker workflow and requires F1. The assertion is that a large durable run can receive a rapid burst of agent activity without blocking UI requests, retain every event at completion, and still publish native tools and the final response.

## Fixture and commands

Isolated CLI tracker, EdgeWorker, LinearActivitySink and real Codex `gpt-6.1-sol` (low reasoning), with paged factory-context. RPC port 3600; UI port 3496; home `/tmp/factory-ui-burst-home`. Reused clean fixture repository `/tmp/factory-capture-correction-repo`; a separate worktree was created for this drive.

The custom `ui-burst` workflow has one native input-inspection role. Its declared input is a small plan. A test-only preparation hook adds a 58.7 MB receipt to persisted run outputs, and a role-entry hook injects 500 synthetic 10 KB tool-result activity messages through the real runtime logger. The native agent subsequently reads the plan through MCP and returns its JSON summary. Synthetic messages exercise the streaming persistence burst; they are not claimed as 500 native tool invocations.

```sh
CYRUS_PORT=3600 ./apps/f1/f1 ping
CYRUS_PORT=3600 ./apps/f1/f1 create-issue --title 'UI remains available during agent activity bursts' --description 'Native input read and final response alongside a 60MB persisted receipt and 500 synthetic tool events.' --labels ui-burst
CYRUS_PORT=3600 ./apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3600 ./apps/f1/f1 view-session --session-id session-1 --limit 10 --offset 0
CYRUS_PORT=3600 ./apps/f1/f1 view-session --session-id session-1 --limit 3 --offset 0
```

A separate HTTP probe sends 40 GET requests to the UI at 150 ms intervals, each with a three-second timeout. Fixture hooks, worker and probes live under `/tmp`; they do not modify product source or production runs.

## Results

- Issue `DEF-1` / `issue-1` routed to the labelled workflow; session `session-1` created a separate worktree and completed.
- The injected 500-message burst took 0.44 ms to record in memory. Full run size afterward: 63,804,703 bytes.
- All 40 UI probes returned HTTP 200, with zero errors; maximum observed latency 293.6 ms.
- Completed persisted run has 510 events, including all 500 injected messages, and the correct native summary. Final file size: 63,843,596 bytes.
- Seven timestamped tracker activities include thoughts, real MCP list/read actions and final JSON response. Pagination returns three of seven records.
- Focused unit/server/evidence checks: 56 tests pass. The red regression observed 500 immediate notifications/writes before the fix; after batching it observes one save per burst, immediate checkpoint flushing and a shutdown flush.
- Full build/typecheck and targeted Biome checks pass.
- Graceful worker shutdown completed and ports 3600/3496 were released.

## Limits

This drive validates workflow persistence and native activity delivery; the large receipt and 500-message burst are injected at the real logger seam. No visual UI behavior changed. Agent activity has a 250 ms persistence window between checkpoints; a hard crash may lose the trailing activity window. Execution checkpoints, workflow messages and final states still save immediately.
