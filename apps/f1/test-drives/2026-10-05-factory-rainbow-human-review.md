# RainbowBob factory, human review and large-run validation

Date: 2026-10-05. Payload: Taskbot #23, #26–#30 and #32; baseline
`93aa03a58857aa8e9e5d4db1512a6d0bdcbdd241`, draft [PR #1](https://github.com/Attraccess/bobs-factory/pull/1).

## Applicability and setup

F1 is applicable to changed issue routing, native session recovery, activity
formatting and human-review lifecycle. The scoped drive used the real compiled
EdgeWorker, issue-tracker RPC/Linear activity sink and authenticated Codex
runner (`gpt-6.1-sol`, low effort), with paged factory-context MCP tools.

Isolated repository: `/tmp/factory-overnight-drive`; state:
`/tmp/factory-overnight-fixture`; RPC port 3600, factory UI port 3495.
`/tmp/factory-overnight-worker.mjs` retained tracker state across restarts.
Only GitHub provider commands were intercepted using local deterministic
readiness, queue and merged-state fixtures. Git commands and native agent
conversations were real. No real GitHub PR was approved or merged by this drive.

The test workflow exercised native clarification, durable questions, decision
recording, draft receipt, CI/readiness, guide, human review, rejection feedback,
native fixing, a fresh human gate, approval and merge confirmation. Scripted
provider/guide fixtures made this a lifecycle test, not a claim of independent
implementation or screenshot quality.

## Assertions and observed results

- F1 `issue-1` / `session-1` routed to the configured workflow and repository.
  Native clarification waited for answers; it did not approve itself. The UI
  retained typed answers and showed submission feedback.
- The first handoff stopped on a dirty workspace caused by generated `.claude/`
  files in the isolated repository. Excluding those fixture-generated files in
  `.git/info/exclude` and retrying continued from handoff without repeating earlier
  steps. Production repository configuration was not changed for this test.
- A graceful restart retained pending gate
  `623978f6-61d1-428e-b4ce-05c973319a49`, head
  `003f4f8943e40f4ae8369a678fa010cb88c8912f`, eight completed steps and native
  conversation `01a10956-2b7c-77e0-9f8b-28f8b26a8846`. No automatic approval occurred.
- UI rejection submitted instructions with a disabled/loading control. A
  fixture-only 1.6-second request delay made that state observable. The native
  fixer consumed MCP context and previous feedback; gate
  `2c33a1b0-6ea4-409a-a95e-8a327287cd67` required fresh approval.
- UI checklist approval selected the approved revision; the provider fixture
  entered its required queue, then reported MERGED. The run completed and
  settled only after that confirmation.
- A manually launched native run
  `manual-eef72789-f4dd-456b-84bf-f2dcde55ba7f` was interrupted during clarification.
  Restart retained conversation `01a1095b-c99b-7b90-a1c9-1c4fe3638d4d`, pass one
  and previous history, then reached questions. The UI Stop control subsequently
  stopped that isolated run. The F1 activity output retained readable thought,
  action and response events.

## Browser and performance checks

Used the product-native T3 collaborative browser at 390×844 and desktop widths,
in light/dark/system appearances. An isolated server on 3493 supplied mock data,
never a real user run: 4,500 conversation entries, a large custom document and
500 screenshot metadata records referencing an explicit fixture image.

- Initial conversation request fetched 120 records and mounted seven nearby
  rows. Collapsed step conversations did not fetch their histories.
- Scrolling away stopped following. SSE notifications while reading did not
  fetch more transcript pages; returning to latest retrieved current messages.
  Older records loaded separately, with stable keys and retained disclosures.
  After correcting the offset sign, the same partially visible message remained
  within two CSS pixels after prepend (the scroller border).
- A 500-image gallery mounted ten nearby image elements, six of which loaded
  sources. Full custom artifacts loaded only when opened; adjacent small
  artifacts used versioned prefetching. Mobile layout had no horizontal overflow.
- Artifact inspection, screenshot back/Escape focus, recipe ownership/defaults
  and provider settings worked in the isolated UI.
- Today Settle persisted view state, removed the selected finished run from
  focus, placed it in Settled and displayed Undo. This action never approved a PR.

T3 screenshot and recording calls repeatedly returned a preview-client error;
DOM/interaction checks succeeded. No screenshots or video evidence are invented
or substituted with a different browser. Visual pixel review remains limited.

## Production deployment check

Backed up state before restarting `gui/501/org.nixos.cyrus`. SIGTERM closed the
old listeners and saved progress, but the old process lingered; after confirming
the saved checkpoint, launchd kickstart loaded the current build. Active run
`manual-cffae79b-5ed0-4572-945b-493296377408` resumed `pipeline/code-review` with
the same native conversation `01a10971-0665-7752-9f19-17af6bebad51`, pass five
and all 33 completed steps. Its paged chat endpoint returned HTTP 200 and the
native browser displayed tool groups and live entries. Its PR was not approved
or merged during verification. The old backend/new frontend mismatch explained
the user's Settle failure and chat “Not Found” reports.

## Automated checks and limits

- Root `pnpm build` and `pnpm typecheck`, including the browser bundle/type check.
- 69 relevant pagination, workflow, readiness, API/SSE and incremental-evidence
  tests passed. The additional duplicate-truncated-event fix passed all nine
  conversation formatter tests.
- All 105 existing AgentSessionManager tests passed across 13 files.
- Reuse checks cover per-image acceptance, dependency/image hashes and stale
  artifact revisions; budgets reject excessive/duplicate new capture plans.
- Two pre-existing dependency advisories remain unpatched upstream:
  node-forge GHSA-86w9-cpqp-85rv and braces GHSA-vfj7-8cjw-p6xm. New dashboard
  dependencies introduced no additional advisory; `pnpm audit` is not green.
- GitHub branch-rule behavior is covered by provider fixtures and unit tests;
  a real remote merge queue was not exercised. Demo video implementation remains
  explicitly deferred in Taskbot #31.

## Live formatting follow-up (Taskbot #33)

The reported live-update failure was reproduced with a tool message whose JSON
prefix was removed by the runtime's 20,000-character tail cap and whose length
sentinel was then removed by the 3,000-character page preview. Its duplicate
event was mistaken for plain Workflow text. A regression now verifies initial
and delta page merges, legacy copies, genuine long workflow logs, event-only
transcripts and provenance persistence; all 50 relevant tests pass.

A new isolated native Codex run,
`manual-c978a4cd-bd2c-486a-aaf4-868beda1f25f`, executed a large shell-output probe
in the same F1 worker on 3495/3600. The T3 mobile browser remained open while SSE
advanced through agent, Bash tool and final response. Only genuine start/finish
logs rendered as Workflow, with no escaped tool JSON. The native tool result
contained 61,199 characters and its 20,000-character event tail retained agent
provenance. The legacy failure is also covered by the deterministic initial/delta
regression. Explicit source metadata
is stored before truncation, and complete session entries own chat rendering.

## Active visual-workflow upgrade (Taskbot #34)

The active Attraccess run's scope/capture prompts were already upgraded, but its
saved stock visual-review prompt was not: a migration constant had an escaped
newline rather than the actual newline in the saved prompt. Its prior scope also
contained combined matrix labels. The migration now matches that exact stock
prompt, preserving custom prompts and role models. Repeated visual-scope
instructions explicitly compact a legacy matrix into the representative budget,
retaining cumulative feature requirements instead of historical combinations.

All 37 workflow/incremental/pipeline tests passed, including the saved reviewer
migration and preservation of custom model/prompt settings. Applying the compiled
migration to the actual saved run produced the current stock scope, capture and
reviewer prompts with unchanged runners/models. The run was still at code review;
its next visual-scope result had not yet been generated during this check.

## Bounded recovery and no-change CI routing (#43/#45)

F1 applies to this runtime/session recovery change. The isolated compiled EdgeWorker on
RPC 3600 / UI 3495 used real Codex and factory-context MCP with a nested test workflow.
Only GitHub readiness was fixture-backed; Git/native conversations and issue-tracker
activities were real. No real PR was approved or merged.

- Manual run `manual-f45ff658-ff54-4d8a-bc06-4e40a7562b34` completed its first review,
  hit maxVisits=1, and displayed **Continue (+4 passes)** in the mobile native browser.
  Clicking it continued at review pass 2, preserved the first draft/review outputs,
  and reached pending human gate `f68c0cb4-365e-4775-8ba0-4de1332f54cf`.
- F1 RPC created `issue-2` / `DEF-2` and started `session-2` with the configured
  nested recovery workflow. It stopped at the same limit; explicit retry retained
  all previous work and persisted `additionalVisits.code-review=4`. It reached
  gate `9cfad0ea-1af7-4f6c-8b0d-e45bfb8b03f7`, revision
  `003f4f8943e40f4ae8369a678fa010cb88c8912f`, six history records and no human decision.
  `f1 view-session` showed real thought/tool activity via the CLI issue tracker.
- 61 tests across WorkflowRuntime, MergeReadiness, FactoryPipeline, FactoryServer
  and Incremental passed. They exercise re-exhaustion after exactly four additional
  nested passes, restart persistence, stock/custom routing migration, same-revision
  skip vs changed head/base/dirty/missing provenance, transient transport retry and
  cancellation, meaningful vs informational comments, and edited comment hashes.
- Current stored production definition upgrades CI routing without changing role
  models/prompts or 47 completed records. Real code/base changes still return to
  code review; no-change assessments return directly to readiness only when Git
  and saved accepted review provenance agree. The human approval gate stays intact.

A follow-up safeguard makes an unknown/new/rejected complaint conservative even
at the same commit: CI fixer explicitly sets reviewRequired=false only for
informational/already-accepted unchanged requirements. Review threads and requested
changes always require review; three additional routing cases passed (57 tests in
the runtime/readiness/pipeline subset). Legacy assessment timestamps now retain
the latest assessment, while content hashes continue to detect later edits.


## Coordination gate continuation

F1 issue `DEF-3` / `issue-3`, session `session-3`, used one real native Codex
reviewer followed by nine deterministic review-gate passes and nine counter-script
passes. It completed with 19 retained history records and `cycle.count=9`;
`code-review.maxVisits=1` remained unchanged. This exercises the larger bounded
stock tool ceiling without granting extra compute-heavy agent passes. The
migration regression preserves custom tool limits and agent limits. All 58
runtime/readiness/pipeline tests, root typecheck and root build passed.

Production monitoring identified this defect after the authorized ninth code
review finished: the old eight-visit gate stopped before consuming its saved
result. The rollout resumes from that gate and preserves the completed reviewer
output, including the new receipt-translation migration finding.


## Quiet readiness activity

F1 `DEF-4` / `issue-4`, session `session-4`, completed four steps with a real
native Codex context probe, built-in readiness and an explicit visible script.
The isolated provider command hook deliberately attempts to log its raw query
responses. The CI activity contains only start, `Merge readiness: 1/1 checks
passed; Approve the review guide to mark the PR ready`, and finish. No provider
JSON enters the conversation. The script retains `Visible script output`.
Complete provider receipts remain in artifacts; no real PR action occurred.
Sixty focused runtime/readiness/pipeline tests pass, including actual spawned
command stdout, quiet failures, explicit CLI output and deduplicated status
updates that still retain freshly changed receipt data.
