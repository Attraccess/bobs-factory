# Question batch ticket notifications

Date: 2026-10-07. Finding: SR-004. Tested the working-copy fix based on
`1bb84b7d245093e1f541df29f17ae9aba8d502c2`, before committing this report.

F1 applies because restored assistance changes ticket-tracking behavior.
The existing QA restart fixture now uses the real Factory runtime, QA tools,
answer API, durable ticket outbox and Taskbot adapter with deterministic mocked
agent results and in-memory Taskbot tool responses. It creates an isolated
temporary repository and home; no live provider or production run is used.

```sh
pnpm --filter cyrus-edge-worker build
F1_AGENT_MODE=mock F1_EVIDENCE_DIR=/Users/jappy/.cyrus/factory/evidence/manual-0b7cf77f-8296-4e61-9df5-b03561e59729/notification-fix bun apps/f1/test-drives/assets/qa-question-restart.mjs
pnpm --filter cyrus-edge-worker test:run test/TicketTracking.test.ts test/WorkflowRuntime.test.ts test/Questions.test.ts test/prompt-assembly.routing-context.test.ts
```

All assertions passed:

- The first blocked QA batch delivered one assistance comment.
- Two unchanged restarts kept its batch identity and delivered no duplicate.
- A saved legacy receipt retained its notification marker after another restart.
- Changed recommendation guidance created a replacement batch and delivered a
  second comment containing the new guidance. Restarting it did not repost.
- The old contextual answer returned HTTP 409; an explicit current answer
  returned HTTP 200 and resumed QA once.
- Still-blocked QA created a third assistance batch and comment. Its explicit
  answer alone completed the fixture; old-context submissions remained rejected.
- The runtime, server and ticket retry service shut down cleanly.

The focused suites passed **118 tests**. Before the fix, the new outbox regression
failed for changed question text, recommendation answer, reason and removal:
only one comment was delivered instead of two. Unchanged and legacy waits passed.

Raw mocked tracker calls, comment bodies, delivery receipts and restart states
are recorded in `notification-fix/qa-question-restart.json` in the evidence
directory above. Live Taskbot delivery, live agent behavior and remote CI are
outside this evidence. Prior SR-001 through SR-003 and QA-001 dispositions remain
settled; the historical recovered capacity-lock incident is unaffected.
