# Software factory MVP

The factory reuses Cyrus's runners, Git worktrees and ticket integrations. Its
local dashboard and JSON workflow graph are deliberately small: no database,
hosted login, queue service or separate orchestration platform.

## Start locally

Install Node/pnpm, Bun, Git, `gh` and the agent CLI you want to use. Authenticate
the agent CLI and run `gh auth login`. The target repository needs an `origin`
remote you can push to, a base branch, and PR CI checks for the factory pipeline.

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

The **Activity** view displays conversations and workflow progress in time order,
using the same runner tool formatters as Linear. Tool calls include their status
and expandable results; **Raw data** retains the original payload. **Show earlier
activity** reveals older entries. Markdown and structured agent responses are
rendered as readable content. Expanded artifact/result panels and their scroll
positions are preserved across live updates and tab switches, separately for
each run, until the page is reloaded.

Select a repository and workflow under **New run**, then fill its launch fields.
**Simple / Cyrus** retains the existing Cyrus execution path and is the initial
default. **Software factory** adds the pipeline
below. Apply `workflow:factory` (or `factory`) to a ticket to select it.
Custom workflow labels are configurable; explicit UI selection wins, otherwise
the first matching configured workflow wins. If no label matches, the configured
default workflow is used. Agent/model labels still choose the run defaults.

In **Workflows**, choose **Default workflow** and click **Save workflows**.
This choice is saved across restarts, applies to new runs without matching
labels, and is preselected under **New run**. You can select any saved non-internal workflow;
choose another default before deleting the current one. Existing runs retain
their workflow.

Both **New run → Agent settings** and each workflow role include reasoning or
variant controls. Claude/Codex use **Reasoning effort**; OpenCode uses **Model
variant**, including custom provider-defined names. The controls forward to
Claude's SDK `effort`, Codex's `modelReasoningEffort`, and OpenCode's
[`--variant`](https://dev.opencode.ai/docs/cli/#run), respectively. Available
levels depend on the selected model; an empty field preserves the native
default (or inherits a same-provider run setting for a role). Switching a role
to another provider does not inherit the previous provider's effort/variant.
Gemini and Cursor currently use their native model settings; their Cyrus
runners do not expose a separate effort control.

**Workflows** also exposes an agent and model field for each agent role, plus the
JSON definition for editing prompts, scripts, tools and graph edges. Empty role
fields inherit the run settings. Changing agent provider without specifying a
model uses that provider's default model. Saved definitions apply to new runs;
an active run retains its original definition.

Clarification pauses until you answer in the dashboard or original agent-session
ticket thread. There is no automatic answer or approval. Decisions and all Q&A
are saved in run history and posted as a comment when a real ticket exists.

The factory runs clarification → decisions → planner/plan-review loop →
implementation → push/draft PR → code-review/fix loop → CI/fix loop → visual
scope → screenshots/visual-review/fix loop → human review guide. The implementer
receives only the accepted plan and its asset references. Reviews retain earlier
findings and fixer dispositions, use stable finding IDs, discard severity 1,
and allow evidence-based rejection and review of that rejection. Visual and CI
fixes return through code review and CI. No step merges or marks a PR ready.

Visual capture requires browser/screenshot tools available to the selected
agent through its CLI or existing Cyrus MCP configuration. Captures must be
real PNG/JPEG files in the supplied evidence directory and cover every requested
area/state. Missing capture evidence fails visibly rather than approving the
PR. The dashboard displays those images and a guide organized around the goal,
before/after behavior, requirements, checks, risks and human review instructions,
inspired by Rocky's visual recap.

## Take over existing work

Select **Take over existing work** in New run and supply an open GitHub PR URL
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
Completed or explicitly terminated runs cannot be retried. Publication uses a
short conventional commit message (`chore: …`) derived from the ticket title,
with the repository's Git hooks and signing configuration still enabled.

## Workflow definition

### Launch fields

Edit a workflow's `launchFields` in **Workflows → Workflow JSON** to customize
the New run form. Only fields belonging to the selected parent workflow appear;
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
their selected outputs, so the implementer retains its plan-only handoff.
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
A call returns `{ "workflow": "checks", "completed": true }`. Internal workflows
are excluded from manual/default/label selection but remain editable. Missing
calls, recursion, nesting beyond ten levels and human checkpoints inside fanout
are rejected. All definitions are frozen in each run, so editing a shared child
cannot change an active run.

Steps execute in array order unless `next` or a matching `branches` edge names
another step. `next: "end"` finishes. A branch such as
`{"when":{"path":"approved","equals":false},"next":"plan"}` loops back.
Each step defaults to at most eight visits (`maxVisits`, configurable up to 100).
Agents return JSON unless `json: false`. `inputs: ["plan"]` restricts supplied
context to those output keys; otherwise agents receive the original input,
launch inputs, outputs, answers and full structured history.

Factory agent roles receive a short role prompt and a private `factory-context`
MCP server. `list_context` browses object fields/array entries; `read_context`
reads values in pages of at most 16,000 characters. Both return `nextOffset`;
follow it until null to read complete discussions and review/fixer history.
Paths use JSON Pointer syntax, for example `/outputs/ticket/comments/0/body`.
Strings use raw text pages; other values use JSON pages. Only the step's scoped
input is served: `inputs: ["plan"]` exposes `/plan` without ticket/history.
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
The Simple path keeps existing multi-repository and platform support. No-check
repositories cannot be declared CI-green. Loop limits, invalid agent results,
missing screenshots and delivery errors stop with an explicit failure. Human
review remains necessary; an automated green pipeline is evidence, not a
guarantee of flawless software.
