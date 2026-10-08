# Codex context readiness and bounded Retry recovery

Date: 2026-10-08

Candidate: `fix/codex-factory-context-readiness`, based on `60532a041a8d6eb7a49cd960bb0bb274c9a072b6`.
The tested source commit is recorded below after committing the implementation.

F1 applies to required MCP startup, native conversation recovery and persisted
Factory output-correction budgets. The drive uses a fresh Git repository and
isolated Factory home, the actual F1 issue/session RPC, production CodexRunner
and app-server backend with a scripted transport, and the authenticated Factory
route fixture for `POST /api/runs/:id/retry`. Other roles use mocked runners.
No provider inference is performed.

From the repository root, after building workspace packages:

```sh
F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/codex-context-readiness.ts
```

Three scenarios passed:

| Scenario | Before Retry | Recovery assertions |
| --- | --- | --- |
| Required context unavailable on first launch | No model turn or usable agent checkpoint; explicit infrastructure failure | After worker restart and Retry, guide completes with required context enabled. |
| Required context unavailable during output correction | One rejected model result retained; failed startup returns the reserved attempt to zero | Restart preserves the candidate and issues; Retry resumes the same native thread and completes the guide. |
| Output correction exhausted | Initial result and two automatic corrections fail | Restart retains exhaustion. Explicit Retry permits one resumed result and at most two further automatic corrections, then fails again. Another explicit Retry succeeds in the same native thread. |

Every scenario creates an F1 issue and linked Git worktree, completes clarify,
implementation and CI exactly once, and retains all three completed history
records through restart and Retry. The final guide has both chapters and
requirements, the active checkpoint clears, activity endpoints return events,
and `f1 view-session --limit 10` renders response activities with timestamps.
Final active and queued capacity counts are both zero; worker shutdown closes
the listeners cleanly.

Passing output:

```text
F1_CONTEXT_RECOVERY_PASS
readiness:  clarify=1 implement=1 ci=1 guide launches=2 model turns=1
correction: clarify=1 implement=1 ci=1 guide launches=3 model turns=2
exhausted:  clarify=1 implement=1 ci=1 guide launches=7 model turns=7
all three runs completed; each retained three prior history records
```

Receipts, run snapshots and rendered activities are retained in
`/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/f1-codex-context-XlDUxU`.
The passing console log is `/tmp/bobs-factory-mcp-readiness-f1.log`.
Early fixture runs exposed an isolated-home migration guard, a synchronous CLI
call that blocked the embedded server, and a polling race before run creation.
The fixture was corrected; the readiness and budget assertions were retained.

Additional checks passed: 129 Codex runner tests; 161 focused EdgeWorker tests
covering workflow runtime, capture recovery, Codex activity and Factory routes;
workspace build and typecheck. A separate native app-server probe without a
model turn confirmed that `mcpServerStatus/list` returns the connected
`factory-context` server with `list_context` and `read_context` on this host.

This is scripted orchestration evidence, not real model judgment or live
feature QA. Retry authentication uses a server-side fixture session; physical
passkey ceremonies and browser interaction are not covered. The production
service, failed run and deployed binary were unchanged.
