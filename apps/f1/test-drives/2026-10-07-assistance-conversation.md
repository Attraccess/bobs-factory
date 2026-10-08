# Assistance replies preserve the fixer conversation

Date: 2026-10-07. Tested `405598b02bb2c4a7b0317d2b04c9afe96281e1aa` plus the
uncommitted assistance fix in this report's commit. PR: [#30](https://github.com/Attraccess/bobs-factory/pull/30).

## Changed behavior

Answering assistance previously cleared the entire active checkpoint. The fixer
lost its conversation ID. The runtime now retains runner/session identity while
clearing completed output and per-turn retry state. Each reply still counts toward
the existing visit limit. Resume guidance directs the agent to the latest answers.

The new regression reproduced the loss before the fix in all four cases:
clarification, CI fixer, code fixer and visual fixer. All four passed afterward.
Their completed steps remain intact, an explanation-only reply stays waiting,
and the explicit fixture decision resumes the same conversation. The next role
starts without inheriting the fixer's conversation. Cached output is absent from
the resumed checkpoint.

## F1 retest

F1 applies to this workflow/session lifecycle change. Adapted the failing QA
question-guidance fixture, adding strict equality assertions for both resume IDs.
Ran a fresh repository/home with `F1_AGENT_MODE=mock`, injected `MockAgentRunner`
for every runner invocation, and disabled background titles. No native provider
process or paid inference ran.

- Created an F1 issue and started its saved custom fixer (`askQuestions=false`).
- Verified full question/recommendation delivery through the dashboard API and
  tracker activity. The saved custom prompt and communication guidance survived.
- Deleted profile definitions, changed defaults and restarted the isolated worker.
  Its original accepted snapshot remained equal.
- Sent an explanation-only reply through F1. The fixer returned a simpler question
  and remained waiting; the downstream receipt did not execute.
- Sent an explicit fictional decision through the contextual answer API. The
  fixer resumed and completed, and the downstream receipt contained both replies.
- Both resumed turns used the original established conversation ID. All three
  calls retained selected author/API environment and excluded the ambient canary.
- Public run records omitted the credential canary. Capacity finished with zero
  active, stopping or queued requests; the owned worker stopped cleanly.

## Commands and evidence

```sh
F1_AGENT_MODE=mock pnpm --filter cyrus-edge-worker exec vitest run test/WorkflowRuntime.test.ts test/EdgeWorker.capture-recovery.test.ts test/Questions.test.ts test/ReviewRecovery.test.ts test/FactoryExecution.test.ts test/RunnerConfigBuilder.prompt-addenda.test.ts
pnpm --filter cyrus-edge-worker build
F1_AGENT_MODE=mock F1_EVIDENCE_DIR=<evidence> node <evidence>/qa57-assistance-fix-f1.mjs
```

All 163 focused tests and the affected-package build passed. Repository build and
typecheck run through the commit hook. The evidence directory is
`/Users/jappy/.cyrus/factory/evidence/manual-a51c4397-ff88-400d-ab07-b692f7f15df5`:

- `qa57-assistance-fix.json`: conversation equality, accepted-profile checks,
  product revision, completion and settled capacity.
- `qa57-assistance-fix-transport.json`: full questions and observable activities.
- `qa57-assistance-fix-receipts.json`: full fixture calls, commands and run history.
- `qa57-assistance-fix-f1.mjs`: reproducible adapted fixture source.
- `qa57-assistance-fix-f1.log`, `qa57-assistance-fix-tests.log` and
  `qa57-assistance-fix-build.log`: executed check output.

## Limits

This retest establishes orchestration and conversation identity with simulated
agents. It does not establish live-model writing quality or authentication.
Previously waived live API-key/GitLab checks, unverified live Codex subscription,
GitHub App/enterprise/hardware authentication and absent Gemini CLI execution
remain limitations. The originating-ticket status synchronization discrepancy
remains documented. No frontend source changed, so no new screenshot is required;
previous accepted visual findings and dispositions remain intact. Full subsequent
review, CI and QA remain the pipeline's responsibility.
