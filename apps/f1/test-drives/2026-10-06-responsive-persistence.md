# Test drive: HTTP responsiveness during session persistence

**Date:** 2026-10-06
**Revision:** 0730d2e7 (final runtime implementation on `fix/responsive-state-persistence`).
**Applicability:** Required: session persistence and save admission change.
**Goal:** Preserve complete history and tracker activities across restart while large saves allow HTTP requests to progress.

## Fixture and assertions

A real EdgeWorker listens on isolated port 3600 with a fresh home and its real
CLIIssueTrackerService. The fixture creates an issue and tracker session, tracks
it in AgentSessionManager, and adds 4,096 historical entries (approximately
256 MiB). Two deterministic native tool messages pass through the production
message formatter and activity sink. Runner launch/resume is stubbed; no real
agent inference, worktree generation or external tracker is needed for this
persistence scenario. Warm sessions are disabled.

- [x] Both tool activities reach the CLI tracker with formatted action content.
- [x] A message arriving during a save is included in the final persisted state.
- [x] Thirty additional overlapping save requests produce one follow-up write;
      requests in the follow-up batch wait for that write. Earlier callers finish
      after their own snapshot, without waiting for later activity. Shutdown adds
      its own save.
- [x] Forty-eight real HTTP status requests succeed during the saves, with a
      maximum measured latency of 75 ms (the assertion requires less than 1 s).
- [x] Stop/start restores all 4,098 entries, their metadata and activity IDs,
      and the session's issue identity; the restarted HTTP endpoint responds.
- [x] Both workers stop cleanly and the temporary history is removed.

## Command and evidence

```bash
node /var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/bob-persistence-f1-hWiOdK/drive.mjs
```

Exit 0. The same directory contains `results.json`. The driver creates a new
isolated directory on each execution. Initial fixture attempts exposed missing
runner/formatter setup; the passing drive explicitly supplies the real formatter
and disables warm sessions.

An additional private reproduction used the real 262 MiB production snapshot:
the original whole-history serialization blocked the event loop for 5,133 ms;
the streaming save completed in 3,963 ms with 159 heartbeat ticks, a maximum
measured event-loop delay of 81 ms, and a deep equality check after loading.
No production history contents are included in this report.

## Regression checks and limits

Core tests: 201 passed, including atomic replacement, stale temporary files,
migrations, JSON encoding, event-loop progress and retaining the previous state
after a serialization failure. Targeted EdgeWorker tests: 53 passed, including
burst coalescing, recovery after a failed save, and workflow launch durability.
Full build and type checks passed.

The drive validates persistence, activity output and restart behavior. It does
not assert native model reasoning, Linear delivery or zrok availability. Startup
still parses the state file synchronously, and each individual transcript entry
still uses native JSON serialization; this fix bounds ongoing work by entries
and write batches rather than imposing a history retention policy.
