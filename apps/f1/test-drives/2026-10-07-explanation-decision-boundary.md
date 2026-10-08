# Explanation requests preserve the pending decision

Date: 2026-10-07. Fix delta based on `d2f0bfc8d92f21a2e321f8129c4bbeb309c58ffb`, included in this commit. All agents were simulated; no provider credits were used.

## Changed behavior and assertions

The existing-session reply “Please explain this more simply. I have not chosen an option or authorized paid tests.” is stored as a question request, without an accepted answer or answered checkpoint. A separate explanation turn rephrases the question. The original fixer is not rerun and downstream work does not start until the explicit decision arrives. Rephrased questions and their batch survive restart without duplicate notification. A malformed explanation that removes a decision fails without advancing.

F1 applicability: the runtime reply and continuation change requires this drive. The self-hosting documentation and binary CI script use direct contract review and native installation smoke instead.

## Executed verification

Evidence directory: `/Users/jappy/.cyrus/factory/evidence/manual-7f0c7c6e-cca1-4387-b7ee-7d81e06997ba`.

- `F1_AGENT_MODE=mock bun run <evidence>/qa-explanation-fix-f1.mjs`: isolated CLI tracker issue, worktree and saved custom fixer with `askQuestions=false`; complete question transport through API and tracker activity; explanation-only tracker reply; explicit API decision; one downstream receipt; clean worker shutdown. Recorded three simulated calls: original fixer, separate explanation, fixer after the decision. Only the explicit decision appears in the receipt's answer history.
- `pnpm --filter bobs-factory-edge-worker exec vitest run test/WorkflowRuntime.test.ts test/Questions.test.ts test/FactoryServer.test.ts test/FactoryAccess.test.ts test/FactoryReviewFeedback.test.ts test/ReviewFiles.test.ts test/RunnerConfigBuilder.prompt-addenda.test.ts`: 157 passed. Includes restart, stale questions, both question-role modes, decorated dashboard replies, duplicate rejection and malformed explanation refusal.
- Workspace build and typecheck passed. Changed-file Biome checks and shell syntax check passed. `pnpm audit` reports no known vulnerabilities.
- Native macOS ARM64 binary built and installed through the stock installer. The corrected `scripts/smoke-binary.sh` completed both startups, verified API 401 without a session and 200 with a private expiring session fixture, checked public assets and scoped MCP, then shut down and restarted. Factory subprocess PATH excludes Node/npm/Bun. The seeded session exercises access enforcement; it does not claim a physical passkey ceremony.
- Self-hosting instructions were checked against `factoryAccess`, CLI setup/recovery commands and the maintained Factory access guide. They now describe implemented passkey protection, configured HTTPS origins, enrollment and recovery.
- Headless `agent-browser` used a fresh named session and the canonical localhost origin. The inspected `qa-explanation-decision-pending.png` shows the rephrased question still pending, with an empty answer field and disabled submission. The session was closed.

Receipts: `qa-explanation-fix-f1-receipts.json`, `qa-final-fixes-summary.json`, `qa-final-fixes-tests-final.log`, `qa-final-fixes-smoke.log` and the matching build/typecheck/audit logs. Binary source/artifact metadata is under `qa-final-fixes-binary-final/`.

## Limits retained

Simulated outputs prove transport and workflow boundaries, not real-model explanation quality or provider continuation. Free-text recognition handles common English explanation requests; the answer API also accepts explicit `kind: "explanation"`. Native Intel, authenticated Cursor and real-agent checks remain excluded by accepted decisions. Physical-device/public-tunnel certification and publication licensing/platform obligations remain outside this fix. Live ticket synchronization and the external hosted MCP catalog remain unverified. Earlier findings and their settled dispositions are unchanged.
