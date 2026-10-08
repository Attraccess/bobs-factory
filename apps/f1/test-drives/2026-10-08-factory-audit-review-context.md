# Factory audit: review outcomes, scoped context and artifact recovery

Date: 2026-10-08. Tested base: `61b0a608eef140149272d34b299a7b61a3a59999` with the uncommitted improvement implementation. Agent mode: deterministic mocked Claude roles through the real F1 `MockAgentRunner`; no provider credits or live model reasoning.

F1 applies because these changes affect Factory agent startup, review gates, role output finalization and resumed native sessions. The fixture uses public issue-tracker RPC and protected Factory APIs, real compiled EdgeWorker/WorkflowRuntime, actual scoped stdio MCP tools and Git snapshots. It creates 3,781 binary assets in an isolated temporary repository and home. UI port 3601 and RPC port 3604 are reserved for the drive; the isolated capacity directory does not inspect or alter live services.

Run from the repository root after building the workspace:

```sh
F1_AGENT_MODE=mock FACTORY_AUDIT_EVIDENCE=/tmp/factory-audit-review-context-coverage-evidence node apps/f1/test-drives/assets/factory-audit-review-context.mjs
F1_AGENT_MODE=mock FACTORY_AUDIT_MALFORMED=1 FACTORY_AUDIT_EVIDENCE=/tmp/factory-audit-review-context-malformed-evidence node apps/f1/test-drives/assets/factory-audit-review-context.mjs
F1_AGENT_MODE=mock FACTORY_AUDIT_NATIVE_FAILURE=result FACTORY_AUDIT_EVIDENCE=/tmp/factory-audit-review-context-native-result-evidence node apps/f1/test-drives/assets/factory-audit-review-context.mjs
F1_AGENT_MODE=mock FACTORY_AUDIT_NATIVE_FAILURE=start FACTORY_AUDIT_EVIDENCE=/tmp/factory-audit-review-context-native-start-evidence node apps/f1/test-drives/assets/factory-audit-review-context.mjs
```

The reproducible fixture is [factory-audit-review-context.mjs](assets/factory-audit-review-context.mjs). Coverage, malformed artifact and both native-error variants reached `completed`, with two actual reviewer turns, three guide turns and exactly one implementation and CI receipt. The final native-error variants additionally assert reviewer conversation continuity and exact effective instruction hashes. The fixture first obtains a real issue/session through `f1 ping`, `create-issue` and `start-session`; before restarting the worker, `view-session --limit 10` displayed 10 of 11 timestamped thought/response activities, including blocked review, clarification, repaired review and bounded artifact submission.

Verified behavior:

- A scripted fresh native attachment failure records an infrastructure checkpoint without an invented native session ID. Retry preserves completed implementation/CI and records the tooling retry separately.
- A blocked review with no findings cannot approve. Its native attempt and review gate record `blocked`; answering assistance executes only that reviewer again in the same native conversation, preserving accepted work. Public runtime tests also cover reviewer assistance across restart and exact-role legacy initialization recovery.
- Actual scoped MCP requests for 1,000,000 characters and 1,000 entries succeed with disclosed caps of 16,000 characters and 50 entries.
- The coverage scenario rejects a guide missing one file; the complete correction finalizes all 3,781 exact paths and a revision-bound review-file snapshot through the artifact envelope.
- The malformed scenario rejects `chapters: [null]` through real finalization. The parsed rejected candidate remains in the correction checkpoint after its artifact file is overwritten and the worker is reconstructed.
- A scripted context failure after native initialization refunds the reserved schema-correction attempt. After restart, explicit Retry retains the native guide session, rejected candidate, issues and unchanged revision, exposing correction generation 1 with zero consumed malformed attempts.
- Separate scripted post-init `runner.start()` and native `is_error` transport failures reproduce the same budget preservation and precise infrastructure receipt. Classification applies to recognizable native transport/auth/tooling errors; model-authored malformed JSON and genuine schema rejection still consume the bounded correction budget.
- Step receipts and native turns have distinct IDs, effective Factory instruction hashes and correction/infrastructure retry reasons. The drive computes the hash from the exact adapter-received `systemPrompt`, `appendSystemPrompt` and `userPrompt`, including the managed capacity addendum. Provider implicit defaults are not claimed. Protected provenance exports omit private task text, and existing attempt receipts survive worker reconstruction unchanged.

Artifacts were retained in the requested `/tmp/...-evidence` directories: `startup-failed.json`, `failed.json`, `timeline.txt`, `results.json` and `cleanup.json`. Cleanup stops the embedded worker in `finally`; repositories and checkpoints remain available for inspection. Assertions operate on the real protected APIs, with an isolated fixture credential enrolled in `FactoryAuthStore`; this is not evidence of a live passkey ceremony.

Limitations: reasoning and native provider tool attachment failures are scripted; actual adapter replay tests separately establish Claude warm-session behavior. The F1 CLI tracker is an in-memory adapter and resets when a new EdgeWorker is constructed. Therefore post-restart model-notification/activity forwarding logs handled “Agent session not found” errors; the drive validates persisted Factory/native recovery, and validates F1 rendered activities before that restart. It does not claim durable external issue-tracker delivery across restart. No uncaught exceptions occurred in the passing scenarios. Frozen old-build provenance and compiled build identity are covered by separate #111 checks.

Related targeted checks passed: 18 MCP pagination/artifact/readiness tests; 46 Claude runner tests; 122 focused Factory pipeline, specialist review, guide artifact, assistance and capture-recovery tests; 15 repository-scope/artifact tests; 27 focused native infrastructure/correction and reviewer-continuity checks after the final changes. TDD reproduced oversized MCP rejection, false-green empty reviews, stale warmed MCP attachments, missing fresh infrastructure checkpoints, incorrect completed outcomes for blocked reviews, escaping artifact roots, lost malformed candidates, lost reviewer sessions, incomplete effective instruction identity and incorrectly charged native transport failures before their fixes.
