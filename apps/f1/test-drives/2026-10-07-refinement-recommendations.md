# Refinement recommendations

Date: 2026-10-07 (Europe/Berlin). Tested `45143ca38bdda80ae57321ae1556311de79c1b89`
plus the implementation working tree. Final dashboard build: `43bb8d9ef49f509a12e2082e`.

## Applicability and scenario

F1 applies to generated question instructions, persisted human waits, contextual
answer validation and dashboard rendering. The isolated fixture uses the built
EdgeWorker, CLI issue tracker, actual factory-context MCP and native Codex runner
(default `gpt-5.5`). Its question-enabled agent asks for notification channel and
schedule decisions, followed by a script receipt. Expected assertions: supported
recommendations reach the dashboard; waiting/restart/display never accepts an
answer; explicit defaults and mixed choices serialize correctly; repeated question
batches reject old contexts; legacy drafts remain deliberate custom answers.
No product implementation or publication occurs inside the fixture.

Repository: `/tmp/factory-recommendations-drive`; worker home:
`/tmp/factory-recommendations-home`; dashboard port 3539; F1 RPC port 3610.
Temporary fixture source and command logs are `/tmp/factory-recommendations-*`.

## Native agent and runtime assertions

```sh
pnpm --filter cyrus-f1 build
apps/f1/f1 init-test-repo --path /tmp/factory-recommendations-drive
node /tmp/factory-recommendations-worker.mjs
CYRUS_PORT=3610 apps/f1/f1 ping
CYRUS_PORT=3610 apps/f1/f1 create-issue --title 'Choose notification preferences' --description '<email/SMS and daily/immediate tradeoffs; request two explicit decisions>' --labels 'workflow:recommendations,codex'
CYRUS_PORT=3610 apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3610 apps/f1/f1 view-session --session-id session-1 --limit 5
```

- DEF-1/session-1 entered the real context/runner path. The native result included
  two string questions, recommendations `Email` and `Daily digest`, and reasons
  grounded in the fictional ticket. No recommendation-only generation step ran.
- Before submission the saved run was waiting, with no answers and no receipt.
  A process restart retained both suggestions and batch
  `e6a6d911-b59e-4b04-8a1a-ed493cd94cab`. The dashboard still selected both defaults.
- Native form validation succeeded with no inactive required textarea. Selecting
  custom focused an empty textarea; a blank selection disabled Send answers.
  Switching to recommendation and back retained `Weekly digest on Fridays`.
- A fixture-injected HTTP 409 left the custom selection/text intact and displayed
  the error. Restoring fetch and submitting both recommendations stored the full
  numbered Q&A with `Email` and `Daily digest` exactly once. The runtime started
  clarification pass 2 and queued its native execution through machine admission.

## Dashboard/API replay assertions

Additional question-enabled **agent** fixtures return deterministic replay data
through the runtime hook. They reuse the native batch and existing isolated
worktree. They execute no native agent or new workspace setup; receipt scripts
only print input JSON and are classified non-intensive. This covers the runtime,
HTTP API and actual built dashboard without bypassing heavy-work admission.

An initial script-based question fixture was discarded as validation evidence:
script recipe schemas do not expose `askQuestions`, so it reached its receipt
without waiting. Corrected fixtures use supported agent steps. Their results are:

- Mixed replay `84931ea2-3824-4bf7-8fa2-8b1c6d3719f7` waited without accepting defaults.
  A separate explicit API answer created a second batch with identical wording
  and a different ID. A mounted edited form retained its custom text, showed the
  stale-draft notice and disabled sending until explicit review.
- Reusing the first batch context returned HTTP 409 with one accepted answer still
  recorded. The old/new batch IDs were `4f5553bf-805b-4f4c-b97f-a8bfc705ff33` and
  `e72a6635-316b-4dca-9386-27e12962fef8`.
- Offline Ctrl+Enter accepted nothing and left the custom text intact. Reconnection
  restored sending. Navigation between Today and the run retained both mode/text.
- After review, Ctrl+Enter submitted recommendation `Email` plus custom text
  `Weekly digest on Fridays`. A delayed fetch and repeated shortcut produced one
  answer request; pending controls were disabled. The receipt completed with two
  explicit answers and the exact mixed Q&A. Pending metadata/batch were cleared.
- Legacy replay `66a96a94-97d7-4c1c-8ee1-47458ec26616` rendered a blank labeled field
  without recommendation controls and waited with no accepted answer. A same-tab
  update snapshot in the historical `{0: "Account 1"}` shape restored that text,
  marked it stale, and required explicit review/submission. Ctrl+Enter then saved
  `1. Which account should receive the message?\nAccount 1` and completed its receipt.
- A real dashboard update from build `185d3dcab47a49dfdec9453d` to the final build
  paused actions until Update now. New mode/text snapshot decoding is also covered
  by the PWA suite; this drive does not claim a live update with edited recommendation
  modes. Old snapshots must be restored in the same tab; opening another tab has
  separate session storage.

## Visual evidence

Inspected final screenshots under the implementation evidence directory:

- `recommendations-desktop-final.png`: 1280×1100, both recommendations selected,
  answers/reasons readable, Send answers available.
- `recommendations-mobile-final.png`: 390×844, custom selected, suggestion still
  visible, retained custom text focused and Send answers available.
- `recommendations-mobile-custom-detail.png`: earlier build, failed-request error
  displayed with the custom draft preserved.

There was no horizontal page overflow at 1280px or 390px. Radios have separate
question-specific names/labels; textareas reference their question text. Final
runtime receipts are saved as `recommendations-runtime.json` beside screenshots:
`/Users/jappy/.cyrus/factory/evidence/manual-dc274dc5-ec1d-46b0-8bb3-d7b0f6792889/`.

## Checks and limits

- Five focused suites cover Questions, WorkflowRuntime, FactoryServer,
  FactoryPipeline and FactoryPwa: 157 tests. All passed across the final runs
  (the four unaffected suites passed together; the affected pipeline rerun passed
  all 37). EdgeWorker capture/output-correction suite passed all 13: 170 total.
- A new correction-path check exercises malformed metadata from a custom role
  inside the bounded agent-output correction boundary.
- Existing visual-recovery fixture waits were one second and failed at different
  asynchronous checkpoints under load. Their three waits now allow ten seconds.
  The final pipeline run passed without the consequent teardown-time ENOENT errors.
- Root `pnpm build` and `pnpm typecheck` passed. Final edge-worker build and
  typecheck passed after the UI refinements. Frozen installation changed no
  dependency manifests/lockfile. Biome passed with 16 CSS warnings; diff check passed.
- The machine's four global slots remained occupied after the process restarts.
  Native pass 2 and an unnecessary API-created setup fixture stayed queued; no
  limit was increased or heavy-work admission bypassed. Native clarification
  after accepting the defaults and its receipt completion were **not observed**.
  Runtime receipt completion was verified with deterministic agent-hook replay.
- The first interrupted fixture process did not serialize CLI tracker state;
  later F1 `view-session` reported that session-1 was unavailable. Persisted
  runtime history/answers and dashboard/API evidence survived. This drive does
  not establish tracker recovery or real remote ticket delivery.
- Queued fixture runs were explicitly stopped through the API (HTTP 200), then
  the worker shut down gracefully. Unrelated factory runs were not changed.
- Originating Taskbot synchronization receipts report in_progress while the
  planning ticket snapshot was backlog. No tracker reconciliation is claimed.
