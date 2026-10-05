# Completed capture correction recovery

Date: 2026-10-05. Tested runtime: `b90ad2e54618c572434a6cd2ad08769685b375fd`. Taskbot #58 / [PR #3](https://github.com/Attraccess/bobs-factory/pull/3).

F1 applies to native runner/session recovery and factory step finalization. The scenario must retry a rejected saved capture at the same clean revision, read a new MCP snapshot, replace only invalid evidence and preserve its conversation and valid captures.

## Setup and execution

- Isolated compiled EdgeWorker: `/tmp/factory-capture-correction-verified-worker.mjs`.
- Repository: `/tmp/factory-capture-correction-repo`; state: `/tmp/factory-capture-correction-verified-home`.
- F1 RPC port 3600, factory API port 3496. CLI issue tracker and activity sink; real native Codex `gpt-6.1-sol`, low effort; real paged factory-context MCP.
- A fixture helper creates three valid 32×32 PNGs. A finalization hook supplies a previous accepted Paid/Free inventory with narrow dependency hashes and a current widened inventory. This deliberately rejects reuse without modifying the native checkpoint. The Web screenshot is fresh and valid.

```sh
CYRUS_PORT=3600 ./apps/f1/f1 ping
CYRUS_PORT=3600 ./apps/f1/f1 create-issue --title 'Verified capture correction recovery' --description 'Retry rejected completed evidence at the same clean SHA using new MCP input and the original native conversation.' --labels capture-correction
CYRUS_PORT=3600 ./apps/f1/f1 start-session --issue-id issue-1
curl -X POST -H 'Content-Type: application/json' -H 'X-Factory-Request: 1' -d '{}' http://127.0.0.1:3496/api/runs/session-1/retry
CYRUS_PORT=3600 ./apps/f1/f1 view-session --session-id session-1 --limit 20 --offset 10
```

## Assertions and results

- DEF-1 / session-1 starts through the issue tracker and routes to the capture recipe.
- Initial failure retains a completed result at clean SHA `cdfee8ef90fef0d58ce0918fc71b50d93b847996`, reporting both rejected states.
- Retry logs revalidation and targeted correction. The correction inventory remains checkpointed when native initialization arrives.
- Native conversation stays `01a10bc4-b1bc-7381-85d5-8cbc0b982bfb`.
- Native tools successfully read `/captureCorrection` from the new MCP snapshot. No `Transport closed` or active-writer error occurs on the successful retry.
- Final run is completed with two history records, three verified screenshots and the same clean SHA. Paid/Free use fresh paths; Web retains its original path. No source changes occur during correction.
- The tracker shows 25 timestamped thought/action/response activities, including context reads, correction execution and the final JSON response. Pagination returns the expected remaining 15 activities.

Earlier native probes caught a closed MCP transport and an active-writer lock while the old process was retained. The final build isolates changed MCP configuration and awaits idle MCP process shutdown; active clients still retain shared processes. A generated `.claude/` directory initially made the fixture dirty, so the final fixture explicitly ignores generated harness configuration to exercise clean-revision recovery.

## Other checks and limitations

49 focused factory/evidence/runtime tests and all 75 Codex runner tests pass. Full build/typecheck and targeted Biome checks pass. Replaying the actual failed billing result through EdgeWorker now resumes targeted correction for five rejected states while preserving its 24-image inventory.

This fixture proves recovery, context freshness and activity delivery. It does not assess application visual quality, which remains the production visual-review role's responsibility. The F1 session and worker were stopped after verification.
