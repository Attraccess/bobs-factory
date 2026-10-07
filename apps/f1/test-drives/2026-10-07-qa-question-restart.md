# QA question batches across restart

Date: 2026-10-07. Base product revision: `ff0665fcc078a898b86fd2b3103bf9b46d19e939`
with the `restart-qa-question-batch` fix applied. Draft PR: [#31](https://github.com/Attraccess/bobs-factory/pull/31).

The changed behavior is recovery of a saved QA assistance wait. Gate revalidation
must preserve the pending question batch when its questions and recommendations
are unchanged. A changed question or recommendation, or a later question round
following a human answer, must retain stale-submission protection.

## Execution

```sh
pnpm --filter cyrus-edge-worker build
F1_AGENT_MODE=mock F1_EVIDENCE_DIR=/absolute/evidence/directory \
  bun apps/f1/test-drives/assets/qa-question-restart.mjs
```

The embedded F1 fixture uses a fresh clean repository and temporary Cyrus home.
Its agent hooks return canned capture/review receipts; no native runner, provider
API or child agent runs. The real `WorkflowRuntime`, persisted checkpoints,
`FactoryTools` QA gate, evidence schemas and `FactoryServer` protected answer
handler execute. API requests use Fastify injection, without opening a browser.
All runtimes and servers shut down in `finally`; temporary evidence remains for
inspection. No frontend files changed, so no new visual evidence was needed.

## Results

- Two unchanged restarts retained the original batch identity and question text,
  left accepted answers empty and did not rerun capture.
- Changing the recommendation kept the same question wording but created a new
  batch. A contextual answer from the old batch returned HTTP 409 without
  accepting an answer.
- Another unchanged restart retained the updated batch. Submitting its saved
  context returned HTTP 200 and resumed capture exactly once.
- The fixture remained blocked after that answer. The next assistance round got
  a new batch ID, rejected the prior round's contextual submission and waited for
  another explicit answer. Only that answer completed the fixture.
- The four focused Vitest suites passed **140 tests**, including unchanged
  recommendations, changed questions, changed recommendation answers/reasons,
  removed recommendations and later identical question rounds.

Raw receipts: `qa-question-restart.json` under
`/Users/jappy/.cyrus/factory/evidence/manual-dc274dc5-ec1d-46b0-8bb3-d7b0f6792889/restart-fix/`.

This is deterministic mocked orchestration evidence, not evidence of live model
reasoning or real record persistence. It supplements prior reports. The accepted
`qa-native-f1-capacity` rejection remains unchanged; native-only criteria are not
claimed passed. Live Taskbot delivery and the backlog snapshot versus in-progress
tracking receipt discrepancy remain unverified.
