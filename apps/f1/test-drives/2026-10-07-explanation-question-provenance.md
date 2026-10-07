# Rephrased questions and explanation revision records

Date: 2026-10-07. Fix delta based on `651a99725770014ad4df51ac43a27ad2a4e3c844`, included in this commit. Agents were simulated; no provider credits were used.

## Behavior and assertions

F1 applies because these changes affect pending questions, restart recovery and per-role revision tracking. A saved rephrasing now identifies its original questions and recommendations. Revalidated changes discard that display and any pending explanation, renew the answer batch and require a fresh answer. Unchanged rephrasings retain their batch after restart. Legacy displays without source context are refreshed once rather than treated as proof of an unchanged decision.

Explanation turns use their own step key for reading and recording revisions. A blocked fixer's earlier output and revision remain paired, so its next visit still sees commits made while waiting.

## Executed verification

Evidence directory: `/Users/jappy/.cyrus/factory/evidence/manual-7f0c7c6e-cca1-4387-b7ee-7d81e06997ba`.

- `F1_AGENT_MODE=mock bun run <evidence>/qa-explanation-provenance-f1.mjs`: isolated CLI tracker issue, worktree, saved custom fixer and protected dashboard. A commit made during the question wait remained visible before and after explanation and worker restart. The original fixer revision and output stayed unchanged. The explanation kept the decision pending; the explicit answer completed one downstream receipt.
- A separate review gate in the same isolated worker rephrased a deployment-access question. After shutdown, the simulated gate changed its question to ask for the available deployment account. Restart displayed that fresh question and changed the batch. A protected API submission using the old context returned 409 and added no answer. A fresh explicit answer resumed the fixer and completed the run.
- Focused runtime, incremental progress, server, question, review feedback, capture recovery and pipeline tests cover question/recommendation changes, unchanged restoration, legacy displays, interrupted explanations and revision isolation.
- The named headless browser session was closed. Inspected `qa-explanation-provenance.png` shows the rephrased question pending after restart, an empty answer field and disabled Send answers.
- Worker build passed. Commit hooks run workspace build, typecheck and staged-file formatting checks.

Receipts: `qa-explanation-provenance-f1-receipts.json`, `qa-explanation-provenance-f1.log`, `qa-explanation-provenance-tests.log`, `qa-explanation-provenance-snapshot.txt` and `qa-explanation-provenance.png`. The initial fixture run failed because its session-specific prompt assertions did not allow the second manual run; the corrected fixture completed both scenarios. This was a fixture failure, not a product failure.

## Limits retained

Simulated outputs prove orchestration and answer/revision boundaries, not real-model rephrasing quality or provider continuation. Native Intel, authenticated Cursor and real-agent validation remain excluded by accepted decisions. Physical-device, public-tunnel and publication certification are not claimed. Live ticket synchronization and the external hosted MCP catalog remain unverified. Previous findings and settled dispositions are unchanged.
