# Software factory MVP

The factory reuses Cyrus's runners, Git worktrees and ticket integrations. Its
local dashboard and JSON workflow graph are deliberately small: no database,
hosted login, queue service or separate orchestration platform.

## Start locally

Install Node/pnpm, Bun, Git, `gh` and the agent CLI you want to use. Authenticate
the agent CLI and run `gh auth login`. The target repository needs an `origin`
remote you can push to, a base branch, and configured branch/merge rules for the factory pipeline.

```sh
pnpm install
pnpm factory --repo /absolute/path/to/repo --agent codex --model gpt-6.1-sol
```

Open http://127.0.0.1:3457. `--port`, `--home` and `--agent` are optional;
defaults are 3457, `~/.bobs-factory` and `claude`. The launcher builds the
required packages first. Its issue-tracker RPC listener uses the next port.
It works without Linear credentials for manually triggered tasks.

An existing `cyrus start` also starts the dashboard on port 3457. Set
`CYRUS_FACTORY_PORT` to choose another port, or `0` to disable it. That uses
your existing Cyrus repository configuration and state directory. The dashboard
binds to loopback separately from the webhook listener and is intended for one
trusted local operator.

## Run and configure

The React dashboard uses TanStack Query for cached requests and mutations, Radix for
accessible dialogs/menus, and Tailwind with the RainbowBob theme. **Today** puts
launching, questions, stuck runs and human reviews first; running work stays in
compact rows and finished work moves into **Settled**. Light/Dark/System themes,
mobile layouts and keyboard shortcuts are available from the sticky header.

Open a run for artifacts and step conversations. Human replies appear on the
right, tools share expandable summaries, and CI polling becomes one status.
Real Markdown, decision records, diffs, provider discussion, screenshots and
review recaps render in the artifact inspector; Raw JSON stays available. Large
artifacts load on demand. Conversations fetch 120 records at a time, virtualize visible rows, and retain a reloadable window of at most 600 records / 2 MiB per open step. Collapsed histories unmount; reading positions and disclosures remain cached. Large raw tool records load only when opened. Screenshot galleries virtualize rows, images load near the viewport, and adjacent small artifacts/images are prefetched unless data saving is enabled. Full JSON remains available explicitly; large Markdown renders in bounded pages. Reading positions, open panels, typed fields and
selected cards survive live updates. A reconnecting SSE connection sends coalesced run/configuration notifications; the UI fetches only changed visible data and refreshes after reconnect or returning from the background. Scroll away from the latest message to
pause following; **Scroll to latest** resumes it. Inspector Escape returns focus
and screenshot Escape returns to the gallery first.

**Simple / Cyrus** exposes a **Message Bob** composer below its conversation.
Send questions or instructions while Claude/Codex is working; after completion,
a message resumes the same native conversation and worktree. Successful submissions
appear as your chat bubbles and remain available after restart. Failed submissions
retain the draft. Use ⌘ / Ctrl + Enter to send; Enter adds a newline.

In **Recipes**, enable **Chat steering** for other workflows, or set `"chat": true`
in their JSON. Chat defaults off for custom workflows. An agent step can set
`"chat": false` to prevent steering or `"chat": true` to opt in independently.
Nested workflows inherit the caller's setting unless they specify their own.
For example:

```json
{
  "id": "interactive-inspection",
  "name": "Interactive inspection",
  "chat": true,
  "steps": [
    { "id": "inspect", "name": "Inspect", "type": "agent", "prompt": "Inspect the requested change; answer follow-up questions.", "json": false },
    { "id": "review", "name": "Review", "type": "agent", "prompt": "Review the result.", "chat": false }
  ]
}
```

Messages target the current agent role. The composer explains when sending is
unavailable: scripts/tools, multiple parallel agents, starting/finishing turns,
unsupported streaming runners, and explicit clarification/review/recovery gates.
Use those gates' existing controls; chat never approves a PR. Runners without
streaming input can still receive follow-ups once a Cyrus session completes.
Completed multi-step workflows retain their existing **Follow-up** action, which
starts a new run; chat does not reopen completed pipeline steps.
Existing runs retain their saved chat setting; old Cyrus runs gain the default
unless explicitly disabled.

Select a repository and workflow in the composer, then fill its launch fields.
**Simple / Cyrus** retains the existing Cyrus execution path and is the initial
default. **Software factory** adds the pipeline
below. Apply `workflow:factory` (or `factory`) to a ticket to select it.
Custom workflow labels are configurable; explicit UI selection wins, otherwise
the first matching configured workflow wins. If no label matches, the configured
default workflow is used. Agent/model labels still choose the run defaults.

In **Recipes**, choose the **Default** pill on the recipe you want.
This choice is saved across restarts, applies to new runs without matching
labels, and is preselected in the composer only when it allows manual starts. You can save any existing workflow as the default;
choose another default before deleting the current one. Existing runs retain
their workflow.

## Launch permissions and origin

Each saved workflow exposes an `allowedTriggers` array. In **Recipes → Launch
methods**, edit **Called by another workflow** (`workflow`), **Start manually**
(`manual`), and **Start from a Linear ticket** (`ticket-assignment`) independently.
The ticket permission covers both assignments and @mentions. Simple has no graph
and cannot grant `workflow`; clone it under another ID with steps to customize.
An empty array disables all new launches. Permission edits are saved atomically;
a referenced child's call permission cannot be disabled while a parent calls it,
including in fanout. A failed save leaves the previous configuration intact.

| Stock or legacy definition without permissions | Normalized permissions |
| --- | --- |
| Simple / Cyrus | `manual`, `ticket-assignment` |
| Public stock/custom workflow | `workflow`, `manual`, `ticket-assignment` |
| Internal/shared workflow | `workflow` |

Explicit arrays (including `[]`) are retained. Legacy arrays and object configs
are normalized on load and saved idempotently, retaining customized roles and
the saved default. Old frozen run definitions normalize from their own saved
flags, independently of current configuration. `internal` remains a shared
presentation and launch-field default; granting a top-level permission explicitly
allows that launch, and operators can add launch fields in JSON if desired.
Factory and Takeover continue calling the same call-only shared pipeline.

Selection is **explicit workflow ID → first matching label in configured workflow
order → single saved default**, preserving existing label case behavior. Check
permission *after* selection. For example, a ticket with `workflow:factory` rejects
if Factory disallows ticket starts even when Simple is eligible. If an unlabeled
ticket's saved default disallows ticket starts, it rejects even when another
recipe is eligible. Enable the selected permission in Recipes, change the
workflow/label, or choose an eligible default; no automatic alternative is used.
Unknown explicit IDs reject. Workflow message selectors are not currently
supported; use the launch methods above. This describes the current product,
and development tasks can request changes to it. Agents evaluate such proposals
against the task's requirements and accepted decisions, within their assigned
role, and update the capability reference when implementing the change. Explicit
planning-only or deferred-implementation restrictions still apply.

Composer only shows recipes allowing manual starts. An ineligible default or
invalidated selected recipe requires choosing an eligible recipe; entered inputs
are retained. With no eligible recipes, Start is disabled and Recipes is linked.
The API and backend enforce the same permission before execution. New follow-ups
require `manual` on Takeover when there is a source, or Factory otherwise.
Answers, feedback, stop, retry and checkpoint resume retain the accepted run;
later permission edits do not strand human waits or replace frozen definitions.

Runs retain `triggerOrigin`: launch type, selected workflow, selection method,
receipt timestamp, and manual composer/API versus follow-up context (including
source run). Ticket receipts retain provider (`linear`, or `cli` for fixtures),
available assignment/mention subtype, workspace/issue/session/comment/activity
IDs, source timestamp and issue URL. Delayed routing or blocking replies do not
replace that original receipt. Original ticket Simple sessions serialize this
metadata too. Called graphs stay in the parent run, with persisted call-start
context and completed history naming the caller workflow, step/key and target.
History and run detail show source links and expandable details across restart.
Historical records without evidence show **Origin unavailable for this older
run** rather than guessed origins. Takeover's existing `source` remains separate.

Both **Composer → Agent settings** and each workflow role include reasoning or
variant controls. Claude/Codex use **Reasoning effort**; OpenCode uses **Model
variant**, including custom provider-defined names. The controls forward to
Claude's SDK `effort`, Codex's `modelReasoningEffort`, and OpenCode's
[`--variant`](https://dev.opencode.ai/docs/cli/#run), respectively. Available
levels depend on the selected model; an empty field preserves the native
default (or inherits a same-provider run setting for a role). Switching a role
to another provider does not inherit the previous provider's effort/variant.
Gemini and Cursor currently use their native model settings; their Cyrus
runners do not expose a separate effort control.

Codex and Claude also offer **Service tier** in run and owned-role settings:
**Default** leaves native configuration untouched, **Standard** explicitly turns
off Fast mode, and **Fast** requests faster processing independently of reasoning
effort. A role inherits a same-provider run tier unless it selects its own tier.
Codex forwards this through `service_tier`; Claude forwards SDK `settings.fastMode`.
Fast availability depends on the model and account and may cost more. Claude
Fast needs a supported Opus model; Claude Code may switch an incompatible model
to Opus. Cursor fast variants use the exact model alias listed by `agent models`,
and OpenCode provider variants remain configurable through **Model variant**.
Gemini CLI does not expose a separate service-tier switch here. Existing runs
keep their saved settings.

**Recipes** also exposes an agent and model field for each agent role, plus the
JSON definition for editing prompts, scripts, tools and graph edges. Empty role
fields inherit the run settings. Changing agent provider without specifying a
model uses that provider's default model. Saved definitions apply to new runs;
an active run retains its original definition.

Clarification pauses until you answer in the dashboard or original agent-session
ticket thread. There is no automatic answer or approval. Decisions and all Q&A
are saved in run history and posted as a comment when a real ticket exists.
Questions include their own brief context, the reason a decision is needed and
the consequences of the choices, so you can answer without reading the step
transcript. Asking Bob to explain or rephrase keeps the decision pending.
Question-enabled roles, including saved and custom recipes, receive this guidance
at execution time. Their question strings support Markdown, small fenced text
diagrams and optional PNG/JPEG images saved in the run's evidence directory.
Use `![caption](/api/runs/RUN_ID/question-images/unique-filename.png)` to display
a local image beside the question; nested paths and external symlink targets
are rejected. Visuals supplement a question that is understandable on its own.

The factory runs clarification → decisions → planner/plan-review loop →
implementation → push/draft PR → code-review/fix loop → CI/fix loop → visual
scope → screenshots/visual-review/fix loop → human review guide. The implementer
receives only the accepted plan and its asset references. Reviews retain earlier
findings and fixer dispositions, use stable finding IDs, discard severity 1,
and allow evidence-based rejection and review of that rejection. Visual and CI
fixes return through code review and CI. A CI assessment that leaves the accepted code and base unchanged returns directly to readiness, verified by Git and saved review provenance. New complaints/rejections still receive review; skipping a comment-only round requires an explicit informational-only assessment. Transient provider transport errors retry in the watcher; recognizable link/build notices do not trigger a fixer, and edited feedback is assessed again. The guide now pauses at an explicit human review gate. **Approve & settle**
authorizes only its displayed commit; **Open diff** opens the provider in another
tab; **Request changes** records instructions, runs the fixer and repeats code,
readiness and visual review before a new guide and fresh approval. Approval marks
the PR ready, honors required reviews/checks/threads/conflicts/rules, enters a
required merge queue or merges normally, and completes only after GitHub confirms
the merge. No administrator bypass is used. Changed/unpublished revisions and
new provider comments return through fixes and review. Draft status and external
reviewer approvals remain visible human actions without preventing the guide.
Human decisions, review IDs, commit IDs and checkpoint state persist on restart.

Repeated agents start with `/progress` through factory-context: their previous
result, prior/current revision, changed files/diff and new history. Planning and
reviews preserve decisions, stable findings and dispositions while assessing new
feedback and affected code. Visual scope keeps the cumulative area/state list.
Capture can reuse real, previously approved images only when their revision is
unchanged or declared dependencies are unchanged and all changed files are
accounted for. Image hashes and dependency provenance are persisted; dirty,
uncertain, changed or unapproved evidence must be recaptured. Otherwise only the
changed areas need a dev server/capture, with subagents where supported. Visual
review retains accepted unchanged evidence; the recap updates changed sections
and can use a short revision summary for a verified minor correction. Every new
human review still requires an explicit decision.

Visual capture requires browser/screenshot tools available to the selected
agent through its CLI or existing Cyrus MCP configuration. Captures must be
real PNG/JPEG files in the supplied evidence directory and cover every requested
area/state. In the factory pipeline, missing capture evidence pauses at the
visual gate with a question explaining the unavailable states and their causes.
Resolve the access, tooling or application setup and answer in the dashboard or
ticket. The same run retries capture and visual review, reusing verified accepted
screenshots when their provenance still matches. Repeated blockers wait for another
answer; an answer never waives missing evidence or approves the PR. This checkpoint
survives restart. The dashboard displays those images and a guide organized around the goal,
before/after behavior, requirements, checks, risks and human review instructions,
inspired by Rocky's visual recap.

## Visual evidence budgets

Visual scope selects individually named representative states, normally 1–2 per
changed area and at most 24 final screenshots. It must not multiply viewport,
language, permission and error-state combinations. Distinct changed layouts or
high-risk rendering justify additional captures; logic/permissions use test
receipts. An unusually broad change may declare `captureBudget` up to 48 with a
concrete `budgetReason`. The runtime validates the selected count and rejects
duplicate states/images in new budgeted inventories.

The visual reviewer returns `acceptedScreenshots` receipts with each inspected
area/state/image hash. These accepted images can survive a partial visual failure
when their dependencies and content remain unchanged. Missing or unverified
critical evidence still blocks the visual gate. Existing in-flight legacy
inventories are retained for safe recovery; the next visual-scope visit uses the
compact contract. Demo videos are tracked separately in Taskbot #31 and are not
implemented in this batch.

## Take over existing work

Select **Take over existing work** in the composer and supply an open GitHub PR URL
or a Linear ticket identifier/URL. That source is all you need: the run title
and requirements come from the ticket or PR. **Additional instructions** is
optional. For ticket assignment, use `workflow:takeover` or `takeover`; the assigned
ticket is the source. Manual ticket takeover needs that repository's configured
ticket integration (the standalone launcher only has its local test tracker).
The source field accepts ticket IDs/URLs or GitHub PR URLs, not task descriptions.
Invalid sources stay in the launch form with an error before a run is created.
Use Software factory for a new task without an existing ticket/PR.

Takeover preserves an existing local branch/worktree, including unfinished work.
When the PR branch is absent locally it starts from the PR's current remote head.
It snapshots the PR body, all comments, reviews and inline review comments,
then assesses completed work, remaining work and risks. A ticket source captures
all ticket comments, metadata and attachment links and finds an open PR for its existing branch.
The assessment feeds clarification and planning; the implementer receives only
the resulting continuation plan/assets. Publication updates the original PR.
Existing ready PRs are converted to draft while the factory processes them.

The MVP supports open PRs in the selected GitHub repository; fork PRs are rejected.
It never resets an existing branch or force-pushes it. If another factory run owns
the worktree, terminate that run first. Diverged local/remote work fails visibly
at push and needs a human decision.

After resolving a failed step's cause, select **Retry failed step** in the run
view. It keeps the same run, worktree, frozen workflow, answers and history,
and continues from saved progress. Completed steps are skipped; an unfinished
script/tool step runs again, so check any external effects before retrying.
An existing run failed at the visual gate for missing evidence opens the capture
assistance checkpoint on Retry. Its frozen recipe must contain the standard
`capture` → `visual-review` → visual-gate path in the same graph; unsupported
custom graphs fail with instructions rather than skipping required review.
An exhausted iteration limit shows **Continue (+4 passes)**. Each explicit continuation grants four additional visits only to the exhausted step, including nested workflows; historical counters and finished steps remain intact. If those additional visits are exhausted, the run stops again rather than looping indefinitely. The limit counts cumulative visits, including returns after real code/visual corrections. Stock coordination tools (review gates, readiness and routing) have a bounded 100-visit ceiling so they do not immediately block an authorized extra agent pass; customized limits are retained.

Completed or explicitly terminated runs cannot be retried. Publication uses a
short conventional commit message (`chore: …`) derived from the ticket title,
with the repository's Git hooks and signing configuration still enabled.

## Workflow definition

### Launch fields

Edit a workflow's `launchFields` in **Recipes → Edit as JSON** to customize
the composer. Only fields belonging to the selected parent workflow appear;
calling a shared workflow does not add its fields. Repository, workflow and
agent settings are common controls. For example:

```json
"launchFields": [
  {"name":"target","label":"App to deploy","required":true,"placeholder":"Customer portal"},
  {"name":"environment","label":"Environment","type":"select","required":true,"defaultValue":"staging","options":[{"value":"staging","label":"Staging"},{"value":"production","label":"Production"}]},
  {"name":"prompt","label":"Additional instructions","type":"textarea","description":"Anything else the agent should know?"}
]
```

Supported types are `text` (default), `textarea` and `select`. Fields are optional
unless `required: true`; labels, placeholders, descriptions and defaults are
configurable. Names must be unique and start with a letter; runner/repository
control names are reserved. The API validates required values and choices before
starting any work. `title`, `prompt` and `source` map to the run title, task
instructions and Takeover source; other names become custom inputs. Takeover
always needs a source even if you remove its field. Simple and Factory use the
title/task form when `launchFields` is omitted; old Takeover definitions receive
the source/optional-instructions form. Use `[]` for no workflow-specific fields.

Values are saved as `run.launchInputs` and supplied to ordinary agent, script
and tool steps as `input.launchInputs`, including shared child workflows.
Scripts read them from `FACTORY_INPUT_FILE` (or `FACTORY_INPUT` for small inputs);
tool templates can use
`{{input.launchInputs.target}}`. Steps with explicit `inputs` still receive only
their selected outputs, so the implementer retains its plan handoff. Question-enabled
steps also receive the human answers needed to resolve their blockers.
Custom Simple fields are appended to its task prompt because it uses Cyrus's
original execution path rather than graph steps.

### Steps and shared sequences

Keep the `simple`, `factory` and `takeover` defaults and add another entry to the JSON array:

```json
{
  "id": "checks",
  "name": "Parallel checks",
  "labels": ["workflow:checks"],
  "steps": [
    {
      "id": "checks",
      "name": "Check in parallel",
      "type": "fanout",
      "groups": [
        [{"id":"types","name":"Types","type":"script","script":"pnpm typecheck"}],
        [{"id":"tests","name":"Tests","type":"tool","tool":"exec","args":["pnpm","test:run"]}]
      ]
    },
    {
      "id": "recap",
      "name": "Summarize",
      "type": "agent",
      "runner": "codex",
      "model": "gpt-6.1-sol",
      "prompt": "Summarize the check results. Return {\"summary\":\"...\"}.",
      "next": "end"
    }
  ]
}
```

Factory and Takeover call the same internal `factory-pipeline` workflow.
Changing its role settings, prompts or steps applies to both parents on new runs.
The settings editor shows only agent steps owned by the selected workflow,
including its own fanout groups. Select **Shared factory pipeline** to configure
its shared roles; parents show their own roles only. Run progress still shows
individual nested steps. Earlier saved flat Factory definitions are upgraded while
preserving customized role settings.

Add a reusable sequence with `"internal": true`, then call it using a step:

```json
{"id":"shared-checks","name":"Run shared checks","type":"workflow","workflow":"checks"}
```

Calls execute the child graph, including loops and fanout, then return to the
parent. They share outputs, original input, launch inputs, human answers and complete history.
Use distinct output IDs across sequences when results must coexist; executing
an ID again replaces its latest output but retains every result in history.
A call returns `{ "workflow": "checks", "completed": true }`. Internal workflows default to call-only permissions but remain editable. Declared permissions are authoritative: deliberately enabling manual or ticket starts makes a shared workflow eligible. Missing
calls, recursion, nesting beyond ten levels and human checkpoints inside fanout
are rejected. All definitions are frozen in each run, so editing a shared child
cannot change an active run.

Steps execute in array order unless `next` or a matching `branches` edge names
another step. `next: "end"` finishes. A branch such as
`{"when":{"path":"approved","equals":false},"next":"plan"}` loops back.
Each step defaults to at most eight visits (`maxVisits`, configurable up to 100).
Agents return JSON unless `json: false`. `inputs: ["plan"]` restricts supplied
context to those output keys (plus `/answers` when `askQuestions: true`);
otherwise agents receive the original input,
launch inputs, outputs, answers and full structured history.

Factory agent roles receive a short role prompt and a private `factory-context`
MCP server. `list_context` browses object fields/array entries; `read_context`
reads values in pages of at most 16,000 characters. Both return `nextOffset`;
follow it until null to read complete discussions and review/fixer history.
Paths use JSON Pointer syntax, for example `/outputs/ticket/comments/0/body`.
Strings use raw text pages; other values use JSON pages. Only the step's scoped
input is served: `inputs: ["plan"]` exposes `/plan` without ticket/history.
The stock implementer also receives `/answers` and returns `status`, `summary`,
`checks`, and `questions`. A `blocked` status requires at least one actionable
question; the run waits, persists the blocker across restarts, and reruns only
implementation after the answer. `completed` requires an empty question list.
Clarification asks about explicit backlog/planning-only restrictions before
proceeding. PR delivery verifies commits and a nonempty diff against the fetched
base before pushing; an empty implementation cannot advance to GitHub delivery.
Each role/loop/fanout invocation has a separate snapshot, deleted when the role
finishes, fails or is terminated. Persisted run history remains available in the
UI. This works through stdio for the existing runners and needs no additional
port or service. Simple retains its original Cyrus prompt path.

Scripts run with `/bin/sh` in the worktree and receive `FACTORY_INPUT_FILE`
pointing to complete JSON, plus `FACTORY_EVIDENCE_DIR`. The legacy `FACTORY_INPUT`
variable is also available for inputs up to 16,000 bytes; larger contexts use
only the file to avoid OS environment limits. Prefer reading the file:

```sh
node -e 'const fs = require("node:fs"); const input = JSON.parse(fs.readFileSync(process.env.FACTORY_INPUT_FILE, "utf8")); console.log(JSON.stringify({answer: input.answers.at(-1)?.answer}));'
```

The input file is removed after the command exits. JSON stdout becomes the step
output; other stdout is wrapped as `{ "stdout": "..." }`. `exec` uses an
executable/argument array.
Configured MCP tools can run directly:

```json
{
  "id": "tool",
  "name": "Call a configured tool",
  "type": "tool",
  "tool": "mcp__my-server__my_tool",
  "arguments": {"plan":"{{outputs.plan}}","directory":"{{workspace}}"}
}
```

Exact template references preserve JSON types. String interpolation also works
in `exec` arguments. MCP servers come from the existing Cyrus runner config
(stdio, HTTP or SSE). Human checkpoints belong outside fanout groups. Parallel
groups isolate their output dictionaries, but use the same worktree: reserve
fanout for independent/read-only work to avoid file conflicts.

Submitting answers, starting a run and saving workflows show a spinner and a
pending status immediately. Repeat submissions are blocked while the request is
pending. Successful answers show an acceptance message; failed submissions keep
your input available to retry.

## Persistence and MVP limits

Workflow definitions, runs and screenshots are under `<home>/factory`. Runs
retain complete structured step history and up to 1,500 activity events. A
restart automatically restores running and waiting runs after the service starts.
Completed steps are checkpointed, including loop visits, shared workflows and
individual fanout branches. Unanswered clarification stays waiting for your
answer; accepted answers survive restarts. An interrupted agent resumes its
saved provider conversation in the same worktree, with a fresh context MCP
connection. Manual Simple runs and original Linear/CLI ticket sessions use
Cyrus's existing conversation continuation. Other standalone Cyrus chat/PR
comment sessions are outside factory recovery; use Takeover for existing PRs.
Explicitly terminated, completed and failed runs do not restart. Active runs
saved by earlier factory versions are upgraded using their retained history.
Previously interrupted/stopped historical runs remain unchanged.

An unfinished script or direct tool call is retried from the beginning; use
idempotent commands for steps with external effects. A crash between an external
side effect and saving its result can require the agent to inspect existing
work before continuing. Missing worktrees, repositories or provider transcripts
produce a visible failure instead of silently starting unrelated work. This is
local checkpoint recovery, not exactly-once execution or cross-machine migration.
Termination cancels active runners and script process groups; retained worktrees
and draft PRs stay available for inspection.

Factory delivery currently targets one GitHub repository per run using `gh`.
The Simple path keeps existing multi-repository and platform support. Readiness distinguishes passing CI from a repository with no configured checks;
GitHub must still permit its merge. Loop limits, invalid agent results,
missing screenshots and delivery errors stop with an explicit failure. Human
review remains necessary; an automated green pipeline is evidence, not a
guarantee of flawless software.


## Overnight implementation assumptions (Taskbot #23/#26/#27/#28)

- Use SSE for coalesced progress notifications and TanStack Query for paged,
  cached requests and mutations. Reconnect and refresh after interruptions;
  no hosted service or bidirectional websocket protocol is needed for this MVP.
- GitHub is the merge provider for this MVP. Prefer squash when allowed, then
  merge commits, then rebase; respect GitHub's queue/rules and never force merge.
- Shared workflow models are edited only on their owning recipe. Parent recipes
  show a reference to the shared sequence.
- Settling is presentation state, not authorization to approve/merge a PR.
  Previously completed guides can be settled or followed up; only a new pending
  SHA-bound gate can authorize merge.
- A follow-up on a previously completed run starts a linked-context task using
  Takeover when a ticket/PR exists, otherwise Factory, preserving repository and
  selected agent settings.
- File dependency and image hashes support screenshot reuse; unknown global
  effects require fresh evidence. Brief recap updates never waive fresh approval.
