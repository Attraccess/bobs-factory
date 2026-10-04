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

## Default workflow setting follow-up

Tested the follow-up working tree against `8493f8a` on 2026-10-04. Browser on
port 3467: opened Workflows, changed Default workflow from Simple to Factory,
saved, reloaded the page, and opened New run. Factory was preselected with its
correct description. Test configuration/state was isolated under
`/tmp/bobs-factory-default-check`; the operator's actual default was preserved.

For ticket routing, added two script-only workflows whose output identifies
which graph ran. Set the default to `default-check`, then created F1 tickets
through RPC port 3468. Unlabeled `DEF-1` / `session-1` completed with workflow
`default-check` and receipt `{"chosen":"default-check"}`. `DEF-2` / `session-2`
with label `workflow:label-check` completed with workflow `label-check` and
receipt `{"chosen":"label-check"}`. Both traversed normal ticket/session setup
and created worktrees; no agent or remote delivery was needed for this routing
check. Targeted runtime/API/pipeline checks passed (18 tests), including restart
persistence, legacy array migration, explicit choice precedence, rejected
missing/deleted defaults without a partial save, and retained run definitions.
The isolated worker was stopped after the drive.

## Reasoning settings and reusable Takeover follow-up

Tested the follow-up working tree against `b6abac3` on 2026-10-04. Required:
per-role runner settings, nested lifecycle/human checkpoints and existing-ticket
routing/continuation changed. The test workers were isolated on UI/RPC ports
3467/3468 and 3477/3478; the operator's real configuration stayed unchanged.

Browser checks verified Takeover as a third selectable workflow with a required
PR/ticket source, hidden internal sequences, manual Codex effort and OpenCode
variant controls, custom OpenCode role variant, and saved/reloaded shared-role
`high` effort visible under Takeover. Nested progress expanded individual roles.
The collaborative browser first verified source visibility, then explicitly
reported its automation host disconnected. Headless Chrome completed the
remaining checks with no page errors. Captured settings/progress images were
inspected locally; they are temporary QA artifacts, not agent visual-review
evidence for a completed factory PR.

F1 ticket `DEF-1` (Continue existing ticket work) was prepared with an existing
branch/worktree at `/tmp/bobs-factory-existing-work`. Commit `f224048` contained
completed-work.txt; unfinished-work.txt remained untracked. `workflow:takeover`
routed session-1 into Takeover, reused that worktree, and preserved both files.
Real Codex / gpt-6.1-sol / high assessed prior work, then the shared clarifier
paused at pipeline/clarify. F1 prompt-session supplied HELLO as the prefix; the
clarifier reran with that human answer and a script returned
`{"retained":true,"continued":true}`. The test shared pipeline was shortened to
clarification plus a retention receipt; it did not exercise full delivery.
GitHub discovery was a local gh fixture returning no PR.

This drive exposed the local Issue.comments stub omitting discussion. Factory
snapshots now use tracker.fetchComments, and the local adapter honors after
cursors. A repeat from fresh state under /tmp/bobs-factory-takeover-check-v2
created a prior comment, then label-triggered session-1 completed with
`{"comments":1,"retained":true}`. A manual attempt while that worktree was in use
failed visibly before execution. A subsequent UI-started ticket takeover
manual-af852b66-a94d-42da-b55b-9d37c45c3ca6 reused the same worktree, included the
comment snapshot and completed with the same receipt. A regression test captures
103 comments across pages, in order, and rejects invalid cursors.

UI-started PR takeover manual-f1f63101-7020-4b6c-8d05-b8152c022086 used a real local
bare Git origin with refs/pull/42/head and a fixture gh API. The PR branch was
absent locally. Setup restored feature/existing-pr from PR head 02651db, retained
completed-work.txt, snapshotted both discussion pages for comments/reviews/inline
comments, converted the fixture PR to draft, and pushed a continuation commit
6268983 to the same branch. Delivery returned the original fixture PR URL; the
recorded gh commands contain no pr create. This verifies real Git restoration
and publication plus PR identity against a fixture; no live GitHub PR was
changed and live CI/visual completion remains outside this drive.

Full affected suites passed: Core 198, Claude 121, Codex 70, OpenCode 32 and
edge-worker 887 (one skipped), totaling 1,308 passing tests. Checks include
native SDK/CLI settings mapping, nested clarification/context/history, frozen
shared definitions, config upgrades preserving customized roles, rejected
missing/recursive workflow calls and checkpoints hidden inside fanout, PR
identity and draft guards. Relevant dependency builds passed; commit hooks
run full build/typecheck and staged formatting. No repo dependencies changed.

A final manual ticket checkpoint check,
manual-d5d13351-3201-48de-bdfb-d100574fec8d, waited in shared clarification. A human
F1 prompt to the original session-1 supplied HELLO; it was routed to this newer
manual takeover rather than its completed original run. The manual run retained
the answer and completed. The check exposed a stale model-variant field being
written back after provider switching; removed-field events are now ignored,
non-OpenCode variant writes rejected, and saved explicit-provider settings
validated before execution. Repeated browser save/reload verified Codex/high
without a stale variant; focused checks passed after the fix.

## Workflow-specific launch fields follow-up

Required applicability: manual source-only Takeover changes request validation,
ticket lookup/context and the run title. Used a fresh worker home at
`/tmp/bobs-factory-launch-fields-check`, UI port 3467 and F1 RPC port 3468.
F1 created `DEF-1` (Continue existing ticket work) and a prior-decision comment.
The Git fixture retained branch `def-1-continue-existing-ticket-work`, committed
completed-work.txt and untracked unfinished-work.txt in its existing worktree.

The collaborative browser verified:

- Simple's title/task fields remain required. Takeover shows only a required
  source and optional Additional instructions, with no title field.
- A saved custom Deploy workflow renders a required App to deploy text field,
  an Environment select defaulting to Staging, and optional Release notes textarea.
- Switching Deploy → Takeover removes custom controls and their required flags.
  A required field belonging to the shared child workflow never appears in its
  parent form.
- Entering only `DEF-1` makes the Takeover form valid. **Start run** creates
  `manual-1ac5e482-d1a1-4a3d-9c91-c071d915eb50`, which completes with the ticket's
  actual title, description and prior comment. It reuses
  `/private/tmp/bobs-factory-existing-work` and retains both files. Its shared
  receipt returns `{"comments":1,"launchInputs":{"source":"DEF-1","prompt":""},"retained":true}`.
- Switching back to Deploy removes the source requirement. Starting
  `manual-d69b5169-9fce-4a8b-98be-0edaf2b631a0` with target Customer portal and
  optional instructions completes; its script receives all three selected
  `launchInputs`, including the Staging default.

This focused drive uses script assessment/receipt steps and a local gh fixture
returning no PR. It exercises the real UI request, EdgeWorker ticket snapshot,
Git worktree selection and shared runtime context; it does not repeat agent
clarification or live Linear/GitHub delivery. Browser console showed no errors.
Regression checks also cover API source-only and legacy payloads, required and
choice validation before starting work, unknown field rejection, fieldless
workflows, persisted custom inputs and plan-only context restriction.

The complete edge-worker suite passed: 83 files, 889 tests passing and one
skipped. Full build/typecheck and staged formatting are enforced by the commit
hook. The isolated worker was stopped after these checks; fixture state was
retained for inspection.

## Takeover source validation follow-up

The reported production failure supplied a feature description in the source
field rather than a ticket/PR reference. Launch validation now rejects that
input before creating a run and gives guidance in the form. Relevant F1 scope
is the unchanged valid ticket lookup/setup path after tightening its entry gate.

Used fresh home `/tmp/bobs-factory-source-validation-check`, UI 3467 and RPC 3468.
F1 created DEF-1 and one prior comment. In the collaborative browser, submitting
`Add UI to configure projects and Linear` kept the dialog open, preserved the
entered value, displayed source/instructions guidance and left `/api/runs` empty.
Replacing it with `https://linear.app/test/issue/DEF-1/continue-existing-ticket-work`
created `manual-028d668e-cdd1-450f-8022-53d1307f5c7b`, which completed with one
comment, the resolved ticket title, and both existing files retained in
`/private/tmp/bobs-factory-existing-work`. Assessment/shared receipt steps were
script fixtures and gh discovery returned no PR, as in the earlier focused drive.
No real production run or ticket was modified by validation. Four focused test
files passed (25 tests), including rejecting invalid sources before the start
hook and continuing to accept bare ticket IDs, Linear URLs and GitHub PR URLs.


## Paged factory context MCP follow-up

Tested the working tree against `10b8c17` on 2026-10-04. Required applicability:
factory agent prompt delivery, role context scope and command execution changed.
The operator's failed Takeover `manual-2fe623a7-5757-4bb7-a2fc-fc431c300886`
failed at assess-existing with Codex's 1,048,576-character starting-input limit.
A real private stdio MCP server successfully browsed that retained PR context
without launching a new production run or changing the ticket/repository.

Created a fresh F1 repo at `/tmp/bobs-factory-mcp-drive` and home at
`/tmp/bobs-factory-mcp-check`, UI/RPC ports 3467/3468. The isolated `context-check`
workflow seeds a 600,000-character irrelevant transport fixture plus the actual
ticket comments and a reviewer/fixer dispute. Its next role's former starting
prompt would have been 1,206,250 characters because outputs and history retain
that snapshot. F1 created DEF-1 (Large context transport) with three ordered
comments, then started session-1 with workflow:context-check and Codex.

Real Codex roles passed these assertions:

- Browsed/read through factory-context MCP; returned all three actual comments,
  including the first/last bodies, bug-1 and its rejected fixer disposition.
- Paused at the human checkpoint with a prefix question; no plan ran first.
- F1 prompt-session supplied `Use HELLO as the greeting prefix.` The next fresh
  role reread that answer via MCP, retained the discussion/dispute and continued.
- The following script received 1,205,921 characters of complete context via
  FACTORY_INPUT_FILE, with FACTORY_INPUT absent. No environment overflow occurred.
- The final agent had `inputs: ["plan"]`: list_context returned only `/plan`;
  reading `/history` failed. Its output retained the accepted plan and answer.
  session-1 completed successfully. The UI showed completed progress and MCP
  tool/results appeared in run activities.

A second UI/API-started fixture, manual-d203445a-544c-4fda-af32-824ac74f411b,
read its MCP input and ran sleep 300. Clicking Terminate stopped the run and
removed its private snapshot; no downstream result was produced. Codex pools
connections briefly, so the context server now watches its snapshot lifetime
and closes when the role deletes it. A direct real-stdio lifecycle check with
an open client verified snapshot deletion closes the helper within one second.
The isolated worker was stopped after validation.

MCP tests passed (38), including complete bounded reconstruction of a value
larger than the runner limit, paging 103 comments without omission, invalid
paths/limits, scope isolation and private file cleanup. Full edge-worker passed
890 tests (one skipped, 83 files); Codex passed 70. New command coverage verifies
1.2MB JSON delivery, deletion after exit and small-input compatibility. Required
build/typecheck and staged formatting passed. No dependencies changed.

This drive validates transport, human loops, scoped handoff and termination.
It does not repeat a full production Takeover implementation/CI/visual delivery.
