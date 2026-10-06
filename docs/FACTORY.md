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

## Install Bob’s Factory

Open your usual **stable HTTPS factory address** with the factory server running.
Keep using the same origin: changing the hostname or port creates a separate app
and separate browser data. Keep your existing access protections in place.
Installation does not make the factory public or keep its server online.
Loopback addresses also work as secure development contexts.

**Install app** in the header explains the browser’s installation path. When a
browser offers a native install prompt, its install button appears in this help
dialog and prompts only after you click. Dismissing it leaves the browser app
usable. Standalone windows show **App help** instead.

| Browser | Installation path |
| --- | --- |
| Mac Chrome | Address bar install icon, or menu → Cast, save, and share → Install page as app. |
| Mac Brave | Address bar install icon, or menu → Save and Share → Install. |
| Mac Safari | File or Share → Add to Dock; requires macOS Sonoma 14 or later. |
| iPhone Safari | Share → Add to Home Screen; enable Open as Web App when offered. |
| iPhone Brave | Use Add to Home Screen if its menu offers it. Otherwise open the same address in Safari and install there. |
| Android Chrome | Menu → Install and create shortcut → Install; menu wording can vary. |

These paths follow the current [Chrome](https://support.google.com/chrome/answer/9658361),
[Brave](https://support.brave.app/hc/en-us/articles/39077114659597-How-do-I-install-and-use-Web-Apps-in-Brave),
[Safari on Mac](https://support.apple.com/en-ca/104996), and
[iPhone Safari](https://support.apple.com/en-lamr/guide/iphone/iphea86e5236/ios)
guidance. Brave’s iPhone menu availability is conditional; the Safari fallback
is the supported alternative. Ordinary Safari and its installed app may have
different site data; do not assume shared cookies or storage.

To uninstall on Chrome/Brave, use the app’s menu or the browser’s app management
page. Remove Safari’s app from Applications/Dock, or delete the iPhone/Android
Home Screen app. Removing an app does not stop backend runs. Clearing its site
data can also remove preferences and unsent browser drafts.

### Disconnection and updates

The service worker bundles maintained Workbox precaching and routing modules
locally; it does not load a CDN or depend on an external app provider. Browser
subresource integrity checks and the server build header validate its allowlist.
After a successful first visit, the service worker caches only the branded
static shell: HTML, versioned JavaScript/CSS, manifest and icons. A cold offline
launch explains how to reconnect instead of loading indefinitely. Run history,
API responses, live events, artifacts, screenshots and raw entries are not
stored in this offline cache. Already-loaded information remains in memory and
is marked potentially stale after disconnection. Drafts remain editable, but
server actions pause; nothing is queued or replayed offline. Reconnection
refreshes configuration and current runs/gates before actions become available.
Unsupported service workers or failed registration leave the connected app
usable.

Updates are offered explicitly. **Later** keeps the mounted app, drafts and
reading position. If its version differs from the server, actions remain paused
until you update. **Update now** waits for outstanding actions to settle, checks
the complete new shell, then reloads only the tab you chose. Other tabs retain
their UI and receive their own update notice. Installation and frontend updates
do not stop, restart, approve or replace backend runs.

An explicit update saves a bounded, tab-local snapshot of unsent launch/chat/
answer/feedback/recipe edits (including global title-agent settings), selected
route, open panels, inspector selection
and stable conversation reading anchors. It contains no query cache, transcript,
artifact or screenshot. The snapshot expires after 30 minutes, is limited to
512,000 characters, and is removed after restoration. Ordinary editing does not
persist these drafts, and a manual browser reload or closing the tab does not
guarantee preservation. Denied/full session storage postpones the update with
edits still on screen. Copy unusually large drafts before retrying.

Restored drafts are never sent automatically. If questions, review gates or
recipe or title-agent settings changed, review the warning and current state before explicitly
acknowledging the draft. Recovered copies remain available when a former gate is
no longer open. Reading restoration fetches the relevant bounded history page;
if its anchor is no longer retained, the app explains that limitation.

Unsent guided-review comments and additional feedback from this tab survive
changes to the same run's commit, guide or gate. They retain their old context
and require acknowledgment before submission to the current review. Old drafts
from another tab's shared storage are not imported across review identities.

For damaged browser caches, first copy unsent drafts and reconnect. Try **Retry
connection**, then **Update now**. If that fails, remove this origin’s service
worker and `bobs-factory-shell-*` caches in browser developer tools, then reload
while connected. The browser’s clear-site-data option is a broader reset and
also removes browser preferences/drafts. Server run/checkpoint data is separate
and remains intact.

The versioned UI sends `X-Factory-Build` on API requests; mismatched writes are
rejected before execution. Configuration edits/launches also check the fetched
recipe revision, and answers check their question/step context. Existing local
automation without this metadata remains compatible and must still satisfy the
Host, Origin and `X-Factory-Request` guards. Such legacy clients do not gain UI
version protection by omitting the metadata.

Push notifications are a separate backlog task, **Taskbot #69: Add opt-in Web
Push for Bob’s Factory attention and completion events**, linked behind #41.
The follow-up will use maintained Web Push libraries: Bob’s Factory server
will send directly to browser push-service endpoints with VAPID authentication,
without a hosted notification provider. Installing this version does not request
notification permission or send push.

### Installation validation record

The 2026-10-05 isolated F1/browser drive verifies Chromium 154 shell caching,
cold offline launch, mobile layout, reconnect, two-tab update deferral, draft/
inspector/reading restoration and continued execution of a waiting run. Google
Chrome 154.0.8037.97 on this Mac also renders the connected app and registers its
worker. These checks do **not** establish native installation completion.

The user waived native-device installation testing on 2026-10-05. Native
installation/standalone launch through the protected HTTPS origin on Mac Chrome,
Brave and Safari, and iPhone Safari/Brave, has not been verified.
Desktop UI automation was unavailable; no iPhone/iOS version was confirmed.
Installed Brave 154.1.96.61 and Safari 26.6.2 are inventory, not passing test
results. The 390 × 844 screenshot is Chromium emulation, not iPhone evidence.
Android Chrome’s physical-device check is explicitly waived because no test
device is available. See the [scoped F1 report](../apps/f1/test-drives/2026-10-05-factory-pwa.md)
for exact assertions and limits, including the Workbox follow-up drive.

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

Slack and Zulip sessions listed in the dashboard use the same composer and
feedback controls. Completed chats continue through their platform handler,
preserving the native conversation, workspace and title across restart. If a
chat needs a new workflow instead, its follow-up uses the default repository
available when the chat was created.

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
Custom workflow labels are configurable. New launches use an explicit manual
UI/API choice, then a `[workflow=<id>]` selector in the original triggering
comment, then the issue description, then the first matching workflow in
configured label order, then the saved default. Agent/model labels still choose
the run defaults. Workflow selection is independent of repository routing.

In **Recipes**, choose the **Default** pill on the recipe you want.
This choice is saved across restarts, applies to new runs without matching
labels, and is preselected in the composer only when it allows manual starts. You can save any existing workflow as the default;
choose another default before deleting the current one. Existing runs retain
their workflow.

## Launch permissions and origin

Assign an issue with `[workflow=factory]` in its description to Bob, or mention
Bob in a new comment containing `[workflow=takeover]` and your additional
instructions. The original comment overrides the description; historical
comments never select a workflow. Both plain brackets and escaped brackets
(`\[workflow=factory\]`) work, with case-insensitive `workflow` keys and exact IDs.
Selectors in Markdown blockquotes, fenced/indented code, inline code, or paired
single/double/curly quotation marks are examples and are ignored. Quotes must
close on the same line and begin outside a word, so apostrophes in normal prose
are preserved. Repeated identical selectors are allowed. Distinct selectors or
malformed attempts in the winning source reject visibly; lower-priority conflicts
cannot invalidate a higher-priority choice. Unknown or disallowed selections do
not fall back to another workflow. Correct the selector, label, saved default or
**ticket-assignment** permission in Recipes before starting a new session.

Only one launch may own a provider/workspace/issue identity at a time, including
repository-choice, dependency, clarification, review and recovery waits. New
mentions on active issues reject with the active run ID. This is a temporary
policy until [#36](https://taskbot.apps.janjaap.de/p/bobs-factory/t/36) adds
configurable parallelism and fallback routing. Native session/activity receipts
survive restart and completion, so webhook redelivery cannot create another run.
A later distinct session can launch after completion or explicit stop. Interrupted
startup without a saved session retains ownership; send stop to settle it before
launching again. Repository and runner/model selection keep their existing rules.

Replies, blocker answers, stop and resume use the accepted workflow and origin;
reply selectors do not launch replacement work. Replies target their native
session. Ambiguous issue-only replies require the specific run's UI. Chat uses
the accepted recipe settings and streaming runner capabilities; ordinary replies
cannot approve human review. Delivery without native source identity or to an
unsupported checkpoint explains the limitation in Linear. An interrupted reply
receipt is retained to avoid applying an answer twice; inspect the run and resend
as a new reply if needed. Comments and attachment manifests include every page.

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
implementation → push/draft PR → code-review/fix loop → CI/fix loop → QA story and screenshot
plan → QA execution/screenshot review/fix loop → human review guide. The implementer
receives only the accepted plan and its asset references. Reviews retain earlier
findings and fixer dispositions, use stable finding IDs, discard severity 1,
and allow evidence-based rejection and review of that rejection. Visual and CI
fixes return through code review and CI. A CI assessment that leaves the accepted code and base unchanged returns directly to readiness, verified by Git and saved review provenance. New complaints/rejections still receive review; skipping a comment-only round requires an explicit informational-only assessment. Transient provider transport errors retry in the watcher; recognizable link/build notices do not trigger a fixer, and edited feedback is assessed again. The guide now pauses at an explicit human review gate. **Approve & settle**
authorizes only its displayed commit; **Open diff** opens the provider in another
tab; **Request changes** records instructions, runs the fixer and repeats code,
readiness and QA/screenshot review before a new guide and fresh approval. Approval marks
the PR ready, honors required reviews/checks/threads/conflicts/rules, enters a
required merge queue or merges normally, and completes only after GitHub confirms
the merge. No administrator bypass is used. Changed/unpublished revisions and
new provider comments return through fixes and review. Draft status and external
reviewer approvals remain visible human actions without preventing the guide.
Human decisions, review IDs, commit IDs and checkpoint state persist on restart.

Repeated agents start with `/progress` through factory-context: their previous
result, prior/current revision, changed files/diff and new history. Planning and
reviews preserve decisions, stable findings and dispositions while assessing new
feedback and affected code. QA scope keeps the cumulative story/criterion and area/state lists.
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

## QA and screenshot roles

New stock Factory and Takeover recipes use the versioned `qa-v1` contract while
keeping the existing scope/capture/review/gate/fix step IDs and screenshot URLs.
QA runs for all changed behavior, including API and CLI changes with zero images.
The scope role plans stable stories traced to accepted requirements, decisions
and recorded expectations. Each story has fixtures, ordered actions, observable
criteria, execution instructions and explicit representative screenshot tasks.
A change without executable behavior needs a concrete not-applicable rationale.

The QA role executes the stories with browser, HTTP, CLI or relevant tests and
records expected/observed outcomes and actual check receipts per criterion.
It assesses applicable navigation, feedback, readability and error recovery,
and captures selected states while navigating those flows. It cannot repair
product code. Consequential failures become stable severity 2/3 findings;
optional improvement observations remain visible and nonblocking.

The reviewer checks coverage and real executed evidence, then opens the actual
selected images. The gate independently rejects failed, missing, blocked or
stale criteria even if the reviewer reports no findings. Product failures return
through fixes, code review, CI, QA planning, execution and review. Failed criteria
must be retested before the human guide. QA execution is conservative: every
criterion is freshly executed on repeats; permission to reuse an image never
establishes a behavioral pass.

Missing access, fixtures, tooling or required images waits for assistance at the
same durable checkpoint. Answers retry QA and screenshot review, including after
restart, retaining completed work, findings and provenance-eligible images.
Answers cannot waive testing or approve the PR. Custom recipes need the supported
`capture → visual-review → visual-gate` recovery path; unsupported graphs fail
with a configuration error instead of routing access failures into product edits.
The dashboard shows criterion outcomes, execution receipts, blocked reasons,
findings and optional observations alongside the gallery. The complete human
guide maps actual story evidence to requirements and discloses limitations.

Recognized stock saved recipes upgrade coherently and idempotently, preserving
runner/model choices. Customized affected prompts or routes remain unchanged.
To opt a custom recipe into QA, copy the stock QA roles, `qaContract` markers and
routes together, then reapply custom instructions without removing contract
fields. Already-running recipes stay frozen; legacy screenshot-only evidence
remains readable and resumable and is never presented as completed QA.

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
or a Linear ticket identifier/URL. That source is all you need: requirements
come from the ticket or PR, and the title agent uses that context to name the run.
**Additional instructions** is
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

## Automatic run titles

**Recipes → Run titles** configures one global title agent using the existing
provider authentication. Choose a fast, inexpensive provider/model independently
of run, repository and recipe execution settings. Leaving the agent or model
empty uses the global runner or that provider's global default model. Provider
changes clear incompatible settings; saved choices apply to subsequent jobs.

Every new root run starts with its exact run ID as its display title. A separate
agent generates a short title concurrently with execution, using initial task,
source/ticket context, custom inputs and follow-up feedback. Project `.mcp.json`
servers (or `.cursor/mcp.json` for Cursor) remain available in the isolated title
job. Stdio servers keep the source worktree as their working directory, so
relative scripts and data paths work. Explicit platform or repository
configuration retains its normal precedence. Configured MCP tools
can retrieve missing context, including tasks supplied only as a ticket URL.
The dashboard updates lists and details live. Generation respects the session
limit and primary execution has priority; under a one-session cap naming waits
for capacity. A completed run can still receive its title.

Naming failures or a 60-second generation deadline retain the run ID without
failing execution. Explicit stop cancels naming; shutdown preserves pending jobs
for restart. Successful titles survive restart. Historical runs retain their
names, and retrying, answering or continuing a run does not regenerate its title.
New follow-up runs receive their own titles and explicitly reference their source
run. Equal titles do not imply that unrelated runs replace one another.

Custom title fields have been removed from launch forms. Legacy request titles
are ignored, and title editing is deferred to future work.

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
starting any work. `prompt` and `source` map to task instructions and Takeover
source; `title` is reserved for automatic naming and cannot be a launch field;
other names become custom inputs. Takeover
always needs a source even if you remove its field. Simple and Factory use the
task form when `launchFields` is omitted; old Takeover definitions receive
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

### Guided human review

The shared reader opens **Overview → one page per chapter → Changed files → Decide**.
The retained run header, PR links and revision notices stay available. Segments,
Back/Next, the page selector and Up/k or Down/j navigate the guide. Page links use
`?page=overview`, `chapter:<id>`, `files` or `decide` in the hash route. Page,
visited steps, reviewed markers, disclosures and individual checks stay local to
this browser and this exact guide revision. Moving forward marks a chapter read;
jumping or moving back does not. A replacement guide resets progress. Reading
markers never gate approval, and navigation never submits a human decision.

New guide results require purpose-written `tldr` (90 characters maximum) and
`decision.summaryShort` (160). Every chapter requires `tldr` (70), `beforeShort`
and `afterShort` (50 each), `risk: {level: "low" | "medium" | "high", text}` (70),
and 1–3 `keyChecks: [{do, expect}]` pairs (60 characters per field). Fields must
be nonblank; do not truncate full prose into short fields. Existing full summary,
before/after, checks, risks, files, diagrams and evidence remain in More detail.
Incomplete new output is rejected and sent back to the same guide role for bounded
correction. Older saved guides remain readable without migration or invented
compact text or risk levels.

Optional `flow: {title, steps: [{label, detail}]}` reveals one of 2–8 stages at a
time. Optional `system: {lanes, parts, before, after}` supplies an overview lane
map. Lanes use `{id, name}`; parts use `{id, label, laneId, status}` with status
`new`, `changed`, `unchanged` or `legacy`. Connections use `{source, target,
label?, weak?}` and are identified by directed endpoints. Chapter
`systemPartIds` must reference existing parts. Before/After toggles work
independently; route hover or focus highlights relevant parts. Screenshot
references retain accepted area/state/caption, with optional known `device`
(`Desktop`, `Mobile`, `Email`, `Reader`) and `language`. Mixed chapters show
one visual mode at a time. Image and diff dialogs support arrows and Escape.

Changed files loads a runtime-owned, immutable snapshot of the guide’s complete
PR merge-base/head pair. The file inventory and bounded per-file patches live
under run evidence, outside dashboard payloads. Later commits, guide refreshes
or completed runs cannot replace that saved diff. Binary or patches over 2 MB
show an explanation and PR link. Chapter claims group real files; shared files
appear in each group but overall counts include them once. Unassigned files are
shown defensively for old/incomplete guides; new guide coverage still rejects
omitted files. Trees distinguish tests, renames and line counts. Split and unified
diffs preserve hunk numbers, empty lines and no-final-newline markers; long diffs
initially display 500 rows and can reveal the rest.

Historical guides without snapshots reconstruct only from retained CI/readiness
and handoff receipts establishing the original revision. The reconstructed
reference is saved separately from the guide. If exact revisions or patches are
unavailable, the reader says so and offers the PR link. File/image loading errors
remain local to their sections and never alter decision availability.
