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
**Simple / Cyrus** retains the existing Cyrus execution path; tickets without
a workflow label continue to use it. **Software factory** adds the pipeline
below. Apply `workflow:factory` (or `factory`) to a ticket to select it.
Custom workflow labels are configurable; explicit UI selection wins, otherwise
the first matching configured workflow wins. Agent/model labels still choose
the run defaults.

**Workflows** exposes an agent and model field for each agent role, plus the
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

## Workflow definition

Keep the `simple` and `factory` defaults and add another entry to the JSON array:

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
