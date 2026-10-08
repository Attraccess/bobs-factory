# Settled ticket ownership: current-main integration

**Date:** 2026-10-08
**PR:** [#23](https://github.com/Attraccess/bobs-factory/pull/23)
**Tested source:** current main `73e40efb44c5f1155e1383238ceea780a451ccdf` plus PR #23's settlement fix and regression cases; runtime/test diff SHA-256 `b3216a12bb8a937ea2404bc0f8dbdeb063b041351d5a4220d29e99caee883317`.

The branch retains all newer Bob’s Factory names, passkey access and capability instructions while adding the explicit settlement rule. F1 applies to ticket admission and session lifecycle.

## Validation

- Replaying PR #23's six regression cases on unchanged current main produced five failures: settled legacy/started/recovery sessions and failed graphs blocked new work, and a completed native session with a live runner allowed competing work.
- With the fix, the complete launch-trigger suite passed: **58 tests**.
- The isolated F1 CLI tracker created DEF-1 and a controlled Simple session in a real Git worktree. Removing its receipt simulated a historical pre-journal session. Stopping persisted its native `error` state, and an attempted new session remained blocked before settlement.
- The authenticated Factory view API explicitly settled that stopped session. The worker checkpointed and restarted gracefully; settlement survived, and no stopped native conversation resumed.
- A new ticket comment selected Takeover, which reused the DEF-1 worktree and reached its controlled clarification checkpoint. A competing comment session was rejected without creating another graph.
- Answering through the protected dashboard API completed the graph and posted its workflow completion comment to the CLI ticket. Final stop/checkpoint and both server shutdowns completed cleanly.

## Fixture and limits

The fixture and before/after receipts are in `node_modules/.cache/settled-ticket-drive-20261008` in `/tmp/bobs-factory-pr23-ship-20261008`; HTTP/RPC ports were 3600 and 3630. The legacy-capacity migration source was an empty fixture directory, so the production coordinator was untouched. The fixture injected `f1AgentHandlers("mock")`, used deterministic Simple/Takeover agents, and disabled background titles. No paid provider or external ticket was used.

A synthetic credential/session existed only in the disposable Factory authentication store. Exact-origin and cookie protections stayed enabled; this did not validate a physical passkey ceremony, live inference, GitHub publication or merge behavior. Historical F1 evidence was preserved.
