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

Select a repository and workflow under **New run**, then enter the task.
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
or a Linear ticket identifier/URL. Enter what should happen next in the task
field. For ticket assignment, use `workflow:takeover` or `takeover`; the assigned
ticket is the source. Manual ticket takeover needs that repository's configured
ticket integration (the standalone launcher only has its local test tracker).

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

## Workflow definition

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
The UI expands shared roles under either parent, and shows individual nested
steps in run progress. Earlier saved flat Factory definitions are upgraded while
preserving customized role settings.

Add a reusable sequence with `"internal": true`, then call it using a step:

```json
{"id":"shared-checks","name":"Run shared checks","type":"workflow","workflow":"checks"}
```

Calls execute the child graph, including loops and fanout, then return to the
parent. They share outputs, original input, human answers and complete history.
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
outputs, answers and full structured history.

Scripts run with `/bin/sh` in the worktree and receive `FACTORY_INPUT` JSON and
`FACTORY_EVIDENCE_DIR`. JSON stdout becomes the step output; other stdout is
wrapped as `{ "stdout": "..." }`. `exec` uses an executable/argument array.
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

## Persistence and MVP limits

Workflow definitions, runs and screenshots are under `<home>/factory`. Runs
retain complete structured step history and up to 1,500 activity events. A
restart marks active runs **interrupted** and preserves history; start a new
run to continue. Automatic recovery/resume is outside this MVP. Termination
cancels active runners and script process groups; retained worktrees and draft
PRs stay available for inspection.

Factory delivery currently targets one GitHub repository per run using `gh`.
The Simple path keeps existing multi-repository and platform support. No-check
repositories cannot be declared CI-green. Loop limits, invalid agent results,
missing screenshots and delivery errors stop with an explicit failure. Human
review remains necessary; an automated green pipeline is evidence, not a
guarantee of flawless software.
