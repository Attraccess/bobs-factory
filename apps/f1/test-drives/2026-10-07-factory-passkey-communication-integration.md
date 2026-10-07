# Passkeys with saved review-fix question guidance

Date: 2026-10-07. Tested clean PR head `dd2b55a6` plus the merge of
`b317ea9e` from current main and the changelog conflict resolution.

## Applicability and scenario

F1 applies to the inherited generated instructions and saved Factory workflow
execution. The passkey implementation and accepted Settings UI are unchanged.
The isolated drive combines the upstream plain-language fixture with this
branch’s authenticated dashboard. All provider calls use `MockAgentRunner`;
`F1_AGENT_MODE=mock` is enforced. No provider credits or production services are
used. Ports 34630 and 34631 and a fresh temporary repository/home were used.

Expected behavior: saved fixers with `askQuestions: false` receive the complete
shared communication and question instructions. Their custom prompt survives.
The question reaches the authenticated API and tracker activity. An explanation
request keeps the workflow waiting; an explicit fixture decision resumes it.

## Execution and results

```sh
pnpm build
pnpm typecheck
F1_AGENT_MODE=mock pnpm --filter cyrus-edge-worker exec vitest run \
  test/FactoryAuth.test.ts test/FactoryAccess.test.ts test/FactoryPwa.test.ts \
  test/FactoryWebClient.test.ts test/FactoryPipeline.test.ts \
  test/FactoryReviewFeedback.test.ts test/FactoryReviewContext.test.ts \
  test/FactoryReviewState.test.ts test/FactoryServer.test.ts \
  test/EdgeWorker.capture-recovery.test.ts \
  test/RunnerConfigBuilder.prompt-addenda.test.ts \
  test/RunnerConfigBuilder.chat-config.test.ts \
  test/prompt-assembly.routing-context.test.ts
F1_AGENT_MODE=mock node <evidence-directory>/ci-plain-language-merge/drive.mjs
pnpm lint
```

All 176 focused tests, build, typecheck and Biome passed. Biome retains the 29
existing nonblocking warnings.

The built EdgeWorker, F1 CLI tracker, activity sink and actual Factory API ran
through issue creation, session start, question delivery, explanation and answer:

- An unauthenticated protected configuration request returned 401.
- A synthetic server-side session scoped to this fixture authorized dashboard
  reads and the explicit answer. This did not exercise WebAuthn ceremonies;
  established cryptographic/browser evidence remains historical.
- All three fixer executions received full shared communication guidance and
  run-specific question instructions, preserving the saved custom prompt.
- The complete initial question reached both the dashboard API and tracker
  notification. A request for a simpler explanation retained the blocker and
  did not execute the receipt step.
- Only the explicit fixture answer completed the third fixer execution and
  receipt. Both human messages were retained. This fictional choice grants no
  permission to skip real checks or use paid agents in this task.
- Both test listeners stopped cleanly. No test server remains running.

Evidence: `/Users/jappy/.cyrus/factory/evidence/manual-09e877cd-6bbb-4ad8-9aec-85b6d59877e8/ci-plain-language-merge/`
contains `drive.mjs`, `drive.log`, `receipts.json` and validation logs.

## Limits

Scripted replies establish instruction delivery and orchestration, not real-model
readability or real-provider behavior. Existing passkey/Settings QA, phone evidence
and screenshots are preserved; no new visual rendering claim is made. Physical
phone outcomes remain operator-reported on an isolated public share. Production
origin enrollment and independently verified live ticket synchronization remain
outside this drive. Human approval remains required for the draft PR.
