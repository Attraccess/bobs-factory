# Software factory MVP drive — 2026-10-04

Base revision: `c1587b98b36583f9a4b274d17f89a3302f1ed7ef`.
Tested implementation: the software factory MVP working tree on
`feat/software-factory-mvp`; this report is committed with that implementation.

## Applicability and scope

Required: the change adds label routing into a workflow, human checkpoints,
fresh agent-role sessions, activity output and cancellation. F1 exercises those
issue/session paths. Browser checks exercise the separate local UI. Regression
tests exercise loops/fanout and delivery gates. This is **partial live pipeline
coverage**, not a claim of a fully completed live GitHub/visual run.

## Setup

```sh
apps/f1/f1 init-test-repo --path /tmp/bobs-factory-mvp-drive
bun run scripts/factory.ts --repo /tmp/bobs-factory-mvp-drive \
  --home /tmp/bobs-factory-mvp-home-v2 --agent codex --model gpt-6.1-sol
CYRUS_PORT=3458 apps/f1/f1 create-issue \
  --title 'Factory visible activity validation' \
  --description 'Add an exported farewell helper. The farewell prefix is unspecified, so ask me which prefix to use before planning.' \
  --labels 'workflow:factory,codex'
CYRUS_PORT=3458 apps/f1/f1 start-session --issue-id issue-1
```

The fixture is a local rate-limiter TypeScript repository on `main`, with no
GitHub `origin`. The worker used UI port 3457 and F1 RPC port 3458. A fresh state
directory was used for the repeated ticket test. Existing fixture worktrees
were retained for inspection; active runs were stopped.

## Observations and assertions

1. `workflow:factory` selected the factory definition and `codex` selected
   `gpt-6.1-sol`. Run ID `session-1`, issue `DEF-1`.
2. The real clarifier asked which farewell prefix to use. The persisted run
   became `waiting`; downstream planning did not start before an answer.
3. Reply through the ticket agent session:

   ```sh
   CYRUS_PORT=3458 apps/f1/f1 prompt-session --session-id session-1 \
     --message 'Use Goodbye, then a space and the name. Export farewell from src/index.ts. No new dependencies.'
   CYRUS_PORT=3458 apps/f1/f1 view-session --session-id session-1
   ```

   The clarifier reran with retained Q&A, returned no questions, decision records
   were saved/posted, and planning began. The timeline showed nine activities
   including the human prompt and both real agent responses. The first drive
   exposed a CLI activity-sink key mismatch; this repeat passed after the fix.
4. Clicking **Terminate** in the browser stopped `session-1` during plan review.
   The retained run became `stopped`; no implementation/delivery followed.
5. An earlier manual factory run, `manual-e3a0c5c3-0b8d-4110-a964-29e533b676f6`,
   was started through the UI. Its prefix question was answered through the UI.
   The real agent clarified, planned, passed plan review and implemented an
   exported `greet` helper. Fixture commit: `60914d9`. Delivery failed visibly
   at `git push` because the fixture has no origin. No fixture PR was created.
6. Workflow role fields changed the clarifier to Codex / `gpt-6.1-sol` and
   persisted through **Save workflows**. A custom two-step workflow was added
   through the JSON editor: shell script writes its PID then sleeps, followed
   by a script writing a downstream marker. UI-selected run
   `manual-516899fc-6429-440b-93a3-951b11ec0e55` started the first script.
   **Terminate** stopped process PID 43814; `kill(pid, 0)` raised
   `ProcessLookupError`, run status was `stopped`, and `downstream-ran` did not
   exist.

## Additional coverage and limits

Focused tests cover persisted answers, late-answer rejection, iteration limits,
fanout concurrency/isolation and sibling failure cancellation, immutable active
definitions, interrupted restart history, plan-only implementation context,
rating 1 filtering, review dispute history, visual and CI fix return paths,
stale/live CI guards, PR guide publication, API lifecycle and local request
boundaries, and cancellation of queued runner starts. A real stdio MCP fixture
verifies tool arguments, environment, working directory and tool errors.

The complete edge-worker suite passed earlier (869 passing, one skipped) and
the additional focused tests passed after their changes. Build and typecheck
are required by the commit hook. No dependency or lockfile versions changed.

Live draft PR delivery, CI repair and screenshot-agent/visual-review completion
remain unexercised together: the fixture lacked a remote/CI and capture-tool
configuration. Those execution boundaries have regression coverage, and the
implementation fails visibly when required evidence is unavailable. Real
Linear network delivery was not tested; F1 tested the issue-tracker adapter.

The T3 browser supported navigation, DOM inspection, form interactions and
termination. Its screenshot/snapshot endpoint failed during the repeated drive;
an earlier UI capture was inspected successfully. No screenshot evidence is
claimed for those failed calls.
