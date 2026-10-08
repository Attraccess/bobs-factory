# Bob's human-facing language

Date: 2026-10-07 (Europe/Berlin). Tested `ec130ae0` plus this change's working tree.

## Applicability and scenario

F1 applies because generated runner instructions change. The actual reported run
paused at `pipeline/visual-fix` with `askQuestions: false` in its saved recipe.
That role could request assistance but did not receive the existing question
guidance. Its question listed internal test IDs without explaining the behaviors.

The isolated drive uses a fresh repository, built EdgeWorker, CLI issue tracker,
activity sink, Factory dashboard API, actual factory-context data and
`MockAgentRunner` for every provider call, including automatic titles. It retains
a custom review-fix prompt and `askQuestions: false`, followed by a script that
records the fixture's explicit decision. No native runner, paid inference,
production run mutation or remote PR action occurs in the fixture.

Expected assertions: full shared communication guidance and question guidance
reach the saved fixer; its original prompt survives; questions reach the API and
tracker activity; an explanation-only reply leaves it waiting; an explicit
fixture decision allows the receipt step.

## Execution and results

```sh
pnpm --filter 'cyrus-edge-worker...' build
pnpm --filter cyrus-f1 build
F1_AGENT_MODE=mock node /tmp/bob-human-language-f1.mjs
```

The fixture invokes the real F1 `ping`, `create-issue`, `start-session`,
`view-session` and `prompt-session` commands on port 3600. Dashboard/API port:
3549. Final receipts:
`/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/bob-human-language-f1-LHileh/receipts.json`.

- DEF-1 / session-1 routed into the saved custom recipe and an isolated worktree.
  All three role executions received the complete shared communication addendum
  and complete run-specific question instructions, despite the false flag.
- The supplied question led with a decision and explained simulated versus real
  agents in separate sentences and two short choices. The dashboard API retained
  the entire string, and the tracker response contained the complete notification.
  F1's table truncates messages to 60 characters; full content was verified through
  its `viewSession` RPC response. The initial fixture assertion incorrectly checked
  beyond that truncation; it was corrected before the successful rerun.
- Waiting saved no answer and did not execute the receipt step. The F1 reply
  requesting a simpler explanation, explicitly withholding a decision and paid
  testing authorization, reran only the fixer. Scripted output returned a simpler
  question; the run remained waiting, with no dispositions and no receipt.
- An explicit dashboard API answer choosing mock results **for this fictional
  fixture** completed the third fixer invocation and receipt. Both human messages
  were retained. This did not waive validation or authorize costs for a real run.
- The worker and both listeners shut down cleanly. No test server remains running.

## Other checks and limits

- EdgeWorker suites: 114 files passed, 1,399 tests passed and one skipped.
  The command supplied filters after `--`, which Vitest did not apply; the whole
  package ran. No additional full-suite rerun was needed.
- Added one execution regression for a saved, resumed review fixer with
  `askQuestions: false`; it verifies the complete question guidance reaches runner
  configuration while preserving the saved prompt and resumed conversation.
- Existing runner-config tests verify complete issue/Factory and chat prompts
  with the shared addendum included. Root build and type checks,
  focused Biome checks and `git diff --check` passed.
- Canned output proves instruction delivery, question transport and workflow
  waiting behavior. It does **not** prove live-model readability, reasoning,
  cost estimation or real-provider continuation. No new screenshot or visual
  rendering claim is made; the UI renderer was unchanged.
