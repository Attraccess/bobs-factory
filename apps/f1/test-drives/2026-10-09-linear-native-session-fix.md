# Linear native session states — Taskbot #101

Date: 2026-10-09. Starting revision: `1fc671a547929aae615fa64e71e5f5a011cf73a5`; the tested fix and this report are committed together.

The human approved a narrow exception for Linear's automatic threaded comments on necessary lifecycle and input activities. Routine progress, tool failures and role outcomes remain thoughts. Native responses, terminal errors, questions and approval requests retain their provider types. Confirmed merge documentation is one response, creating its documentation comment automatically rather than posting a second comment.

## Simulated workflow evidence

Both fixtures use simulated agents, the real SDK, isolated loopback HTTP providers and temporary local state. No real agents, live Linear workspace or provider credits were used.

```sh
F1_AGENT_MODE=mock pnpm --filter bobs-factory-core exec tsx "$PWD/apps/f1/test-drives/assets/linear-publication-101.ts"
F1_AGENT_MODE=mock pnpm --filter bobs-factory-core exec tsx "$PWD/apps/f1/test-drives/assets/linear-delivery-104-110.ts"
```

The publication fixture models native state transitions from emitted activities and rejects auth/select signals attached to anything other than elicitation. It passed clarification/wait, answer/resume, nested and parallel review outcomes, CI failure/resume, confirmed-delivery completion, review readiness, terminal failure/stop, auth/select prompts and subsequent resume/completion. It verifies complete outbound text, bounded diagnostics, local raw evidence, suppressed fenced review contracts and zero restart duplicates.

Result: one explicit decision comment; ten automatic native lifecycle comments (including synthetic lifecycle and signal probes); zero routine progress comments; one confirmed-delivery response; all four modeled states (`awaitingInput`, `active`, `error`, `complete`) verified; both `auth` and `select` verified; 18 local messages; zero unhandled rejections. Exactly one useful delivery comment is created through the native response.

The delivery/ingress fixture passed webhook verification, priority, rate-limit cooldown, lost-receipt reconciliation, restart and credential rotation. Result: six requests, four accepted mutations, four delivered receipts, zero pending and zero unhandled rejections. Credential rotation made four requests and delivered three receipts after the preserved 120001 ms cooldown.

The older fixture failed under Bun 1.3.5 at its lost-final-receipt pending-count assertion (zero instead of one). Running the same unmodified fixture under Node/tsx passed, including reconciliation and duplicate assertions. Bun execution remains a validation limitation; this fix does not change that fixture.

## Other checks

- Core presenter: 8 tests passed; core build and typecheck passed.
- Complete Linear transport package: 62 tests passed, including direct/queued native types, auth metadata, priority, retained diagnostics and recovery.
- TicketTracking, LinearActivitySink and AgentSessionManager publication/tool formatting: 120 tests passed.
- Edge worker and Linear transport typechecks passed.
- Biome and `git diff --check` passed on the changed code.

Logs: `/tmp/f1-101-session-semantics.log`, `/tmp/f1-104-session-semantics-node.log`, `/tmp/f1-104-session-semantics.log` (Bun failure). Temporary listeners and fixture state are cleaned up.

Actual Linear rendering and badges remain unverified under the human's explicit instruction to skip actual Linear tests. Modeled states establish outbound semantics, not observed provider UI behavior. Historical test-drive reports remain unchanged.
