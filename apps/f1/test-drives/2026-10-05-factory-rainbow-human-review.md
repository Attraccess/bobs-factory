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
