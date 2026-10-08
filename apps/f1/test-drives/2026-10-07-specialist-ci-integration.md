# Specialist review integration with current main

Date: 2026-10-07. Tested PR [#32](https://github.com/Attraccess/bobs-factory/pull/32)
head `9bb38497` merged with main `1b30cfb0`, including the QA conflict resolution
and regression checks, before the merge commit.

F1 applies to the combined specialist-review provenance and QA recovery paths.
This drive reused the recorded post-review fanout fixture in a fresh repository
and home. `F1_AGENT_MODE=mock` and injected deterministic agent attempts exercised
the compiled EdgeWorker, production output finalization, CLI tracker/RPC,
workflow fanout and persistence. No live inference, production ticket mutation,
provider publication, human approval or merge was exercised.

The conflict resolution preserves main's evidence-error retry behavior and
this PR's configured specialist inventory validation. A nested-workflow
regression invokes the actual QA gate: valid R1 references pass; an unrelated
reference produces `qaRetry` and an inventory error. Both sequential and later
fanout layouts are covered. The full routing-prompt expectation now includes
the capability text introduced by the prior fixes.

## F1 results

- DEF-1/session-1 ran extraction and six configured specialists through a child
  workflow with a renamed aggregate. Subsequent parent fanout inherited the
  review association; called QA used R1 and the guide retained authoritative
  requirement coverage. A controlled current-head mismatch was rejected by
  the actual human-review tool. The run waited for human review.
- DEF-2/session-2 replaced R1 with an unrelated guide requirement. Production
  validation rejected the output and failed before approval.
- Worker replacement preserved both runs' status, step, errors, histories,
  outputs, review rounds and checkpoints exactly. No completed reviewer replayed.
- A fresh headless browser showed the rebuilt Recipes UI with Instance capacity.
  Its snapshot also contained all six independently editable specialist roles.
  The online screenshot was visually inspected. No settings were changed.
- The named browser session and restarted worker were closed. The isolated
  home, repository and evidence remain available; historical evidence is intact.

## Commands and evidence

```sh
pnpm build
F1_AGENT_MODE=mock node <evidence>/ci-merge/fanout-review73.mjs
CYRUS_PORT=3904 apps/f1/f1 ping
CYRUS_PORT=3904 apps/f1/f1 create-issue --title 'Merged specialist review safeguards' --description 'Reject null input; validate nested review and subsequent fanout coverage.' --labels workflow:fanout73
CYRUS_PORT=3904 apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3904 apps/f1/f1 create-issue --title 'Reject unrelated merged guide requirement' --description 'bad-guide: Reject null input and preserve authoritative requirement coverage.' --labels workflow:fanout73
CYRUS_PORT=3904 apps/f1/f1 start-session --issue-id issue-2
agent-browser --headed false --session ci-merge73 open http://127.0.0.1:3903/
pnpm --filter cyrus-edge-worker test:run --maxWorkers=4
```

Evidence root:
`/Users/jappy/.cyrus/factory/evidence/manual-0b7cf77f-8296-4e61-9df5-b03561e59729`.
The `ci-merge` directory retains the copied fixture, isolated paths, logs,
checks, before/after restart observations and `recipes-online.png`. Dashboard/RPC
ports were 3903/3904. Provider readiness receipts were controlled fixtures;
these results do not establish remote CI or native model behavior.
