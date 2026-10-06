# Ticket synchronization provider error text

Date: 2026-10-06

Changed behavior: render MCP provider text in pending ticket synchronization warnings instead of serializing content blocks. Tested a68e5c2fff3e8deda6974a2a47aad5a4f735d18b plus the visual fix committed with this report.

## Scenario and results

Used a fresh temporary home and Git repository, the real EdgeWorker in CLI mode, Factory runtime/server, and a configured HTTPS Taskbot MCP fixture. Its agent hook holds the run active; the provider resolves the source ticket successfully, then returns an MCP `isError` text block during a progress milestone. No production tracker or runner was used.

Command: `NODE_EXTRA_CA_CERTS=<fixture certificate> node <evidence>/visual-fix-drive.mjs`.

Passed assertions:

- Source ticket resolves and substantive work moves it to In Progress.
- After the provider fails, both the synchronization error and persisted pending receipt equal `MCP tool failed: Taskbot provider unavailable`.
- The run remains active and the ticket remains In Progress.
- In Chromium via agent-browser, the expanded Today row shows the full readable warning and recovery guidance without serialized MCP content. Open run and Stop remain available.

Captured the affected state at 1440×900, English, light theme. Preserved both previously accepted screenshots. Evidence lives in `/Users/jappy/.cyrus/factory/evidence/manual-df3a6623-c843-44af-8926-fdc200996962`: `visual-fix-drive.mjs`, `visual-fix-drive-results.json`, `visual-fix-drive.log`, and `visual-fix-ticket-sync-pending-20261006.png`.

MCP package tests: 41 passed, including exact single-text, mixed-content and nontext error messages. TicketTracking suite: 13 passed. Scope is the failure-message path; prior lifecycle and merge recovery drives remain the evidence for unchanged behavior.
