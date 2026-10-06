# Workflow selectors and ticket delivery admission (#55)

**Date:** 2026-10-05  
**Base revision:** `fb3abd2b` (implementation changes in the working tree)  
**Result:** Local F1, browser and genuine Linear delivery assertions passed. The integration blocker was resolved on 2026-10-06 using the human-created **Bobs Dummy Test** app. Earlier blocked setup records below are historical.

## Scope and setup

This change affects workflow selection, native ticket admission, reply delivery,
restart recovery, and the Factory origin display, so F1 applies. The assertions
cover the changed paths rather than a generic server smoke check.

A fresh F1 rate-limiter repository was initialized at
`node_modules/.cache/workflow55/repo`, with a separate Cyrus home at
`node_modules/.cache/workflow55/home`. Factory used port 3620 and CLI RPC used
3621 to avoid the running services. No production repository or Cyrus config was
modified. The fixture used the real EdgeWorker, CLI tracker, workflow runtime,
worktrees, snapshots, activities, persisted receipts and browser UI. Two test
recipes provided a script-only `origin-probe` and an `answer-probe` with a
deterministic clarifier followed by a script. The clarifier replaces agent
execution only; this drive does not establish real model-runner or Linear
webhook authentication coverage.

The fixture source, webhook replay inputs, run snapshots, check logs and compact
runtime provenance are saved in the factory evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-8321a0ae-7e34-46fc-a622-0acb59021b79`.
The renderer source fingerprint is
`4f058f3cfc5e752f0b26f4c84b8facd069eece791dc999590800505b1f53e049`;
the built renderer fingerprint is
`7950774a7bdbae0bbba8545c3ac5ae8f65a6beef41d86e9adc25e486e06fbf7c`.

## Commands and assertions

The drive used `apps/f1/f1 init-test-repo --path
"$PWD/node_modules/.cache/workflow55/repo"`, then
`bun run node_modules/.cache/workflow55/fixture.mjs`. Subsequent F1 commands used
`CYRUS_PORT=3621`. Fixture-only endpoints created native-shaped mention sessions,
seeded 103 comments and replayed saved deliveries through `handleWebhook`.

| Scenario | Command or action | Observed assertion |
| --- | --- | --- |
| Saved default and complete comments | `create-issue`, seed 103 comments, `start-session --issue-id issue-1` | `session-1` completed `origin-probe`, origin source `default`, and ticket snapshot contained all 103 comments. |
| Description selection and waiting recovery | `start-session --issue-id issue-2`, SIGTERM fixture, rebuild/restart | `session-2` remained waiting with identical ID, recipe, origin, questions and history. |
| Active issue rejection | A new comment mention on issue-2 | New `session-3` received an active-run rejection; no second runtime run was created. |
| Native reply deduplication | Replay the same prompted activity twice, then again after another restart | One answer was recorded, on the original `session-2`; its description-selected recipe/origin remained unchanged despite `[workflow=unknown]` in the reply. |
| Completed created-event deduplication | Replay the original session-1 created event after completion and restart | No replacement run or second worktree was created. |
| Later distinct launch on a completed issue | New comment-110 selected `answer-probe` on issue-1 | New `session-11` entered waiting while session-1 stayed completed; the retained native session's active status did not block admission. Replaying session-1's original event still did not relaunch it. Session-11 was then stopped through F1. |
| Comment wins over description | Comment-106 used `@Bob \[workflow=origin-probe\]`; issue-3 had two conflicting description selectors | `session-4` completed `origin-probe` with `comment-selector` provenance and the original comment ID. Lower-priority conflict was ignored. |
| Unknown selection | Issue-4 selected `[workflow=unknown]` | `session-5` received an unknown-workflow response; no runtime run or DEF-4 worktree existed. |
| Durable rejected delivery | Competing mention while session-6 waited; replay after stopping it and after restart | `session-7` stayed rejected, with a settled receipt and no runtime run. |
| Configured label | Issue-6 used label `workflow:probe` | `session-8` completed `origin-probe` with the exact configured label recorded as the selection source. |
| Disallowed trigger | Issue-7 selected `[workflow=factory-pipeline]` | `session-9` received rejection; no runtime run or DEF-7 worktree existed. |
| Browser answer | Answer session-10 at `/#/runs/session-10`, including `[workflow=unknown]` in the text | The same run completed `answer-probe`, with one answer and unchanged origin. |
| Browser stop | Click Stop and its confirmation within four seconds on session-6 | API and persisted run status became `stopped`; the original workflow and selection reason stayed visible. |
| Older run compatibility | Remove origin only from an isolated completed fixture record and restore it | The browser displayed “Origin unavailable for this older run” and rendered the run normally. The original fixture record was preserved separately. |

`agent-browser --session workflow55` drove the answer and stop controls, checked
the UI at 1280×900 and 390×844, and reported no browser errors. The first stop
attempt let the four-second confirmation expire; the subsequent action confirmed
within that window, and the saved status assertion passed.

## Browser evidence

- [Desktop selection and waiting question](assets/workflow-selector-55/selector-desktop.png)
- [Mobile selection and waiting question](assets/workflow-selector-55/selector-mobile.png)
- [Original run completed by browser answer](assets/workflow-selector-55/selector-answered.png)
- [Stopped run retains its origin](assets/workflow-selector-55/selector-stopped.png)
- [Restored fixture with no historical origin](assets/workflow-selector-55/selector-legacy.png)

## Other verification

- `pnpm install --frozen-lockfile`: passed; no dependency or lockfile changes.
- `pnpm -r --workspace-concurrency=2 --filter './packages/*' test:run --maxWorkers=2`: 2,134 passed, two existing skips, across 16 packages.
- After the final reply-reservation and completed-graph ownership fixes, `pnpm --filter cyrus-edge-worker test:run --maxWorkers=2`: all 95 files passed; 1,050 tests passed, one existing skip.
- Final `pnpm typecheck` and `pnpm build`: passed.
- Changed-file Biome check: no errors; one pre-existing optional-chain warning in RepositoryRouter.
- `git diff --check`: passed.

## Earlier genuine Linear blocker (resolved 2026-10-06)

An authorized isolated Attraccess project and unassigned probes were created:

- [Bob Factory #55 isolated workflow validation](https://linear.app/attraccess/project/bob-factory-55-isolated-workflow-validation-d956cecd46d7)
- [ATT-1134: default launch probe](https://linear.app/attraccess/issue/ATT-1134/55-isolated-default-workflow-launch-probe)
- [ATT-1135: selector and continuation probe](https://linear.app/attraccess/issue/ATT-1135/55-isolated-selector-and-continuation-probe)

The connected workspace exposes Giesela, Rocky and Codex agents, but no Bob
agent. The locally available authenticated token identifies Giesela. No isolated
authenticated webhook route for these probes was provided. These issues were
therefore left unassigned and undelegated. Creating real issues and replaying CLI
fixture events does **not** prove genuine Linear assignment, mention or reply
delivery. Resume validation once the Bob integration and webhook route are
available, or a specific existing integration is authorized for the isolated
worker. This required acceptance evidence remains unresolved.

The temporary local fixture was stopped after the drive. No PR, publication,
deployment or merge was performed.

## Resume: concrete Linear setup (16:17 UTC)

The local Bob Factory connection was confirmed through the installed Linear SDK
to identify **Giesela (Schlepptop)**. Its account lacks administrator permissions;
Linear refused access to webhook settings. A separate Linear-mode worker and
signature-verifying relay are now prepared for ATT-1134 and ATT-1135, using the
dummy repository and isolated state. Other signed events go to the existing
worker. The temporary relay serves no dashboard or configuration API.

Public health returned 200, unsigned delivery returned 401, and public UI/config
paths returned 404. These are setup checks, **not genuine delivery evidence**.
The test issues remain unassigned; no integration setting has changed.
An administrator must temporarily set Giesela's Webhook URL to the prepared
receiver, then restore its exact original value after validation. The temporary
receiver and tunnel remain running for this pending setup; stopping them while
Linear points to the relay could delay other deliveries. Current setup details,
script and checks are saved as `linear55-admin-setup.md`,
`linear55-receiver.mjs` and `linear55-receiver-checks.json` in the evidence
directory. The original F1 fixture remains stopped.

## Resume: separate app requested (2026-10-06)

The human declined changing Giesela's webhook and offered a new Linear app.
The previous temporary receiver is stopped. A fresh isolated gateway, private
credential file and callback route are prepared for **Bob Factory Test**.
Public health, unsigned-webhook rejection, hidden dashboard/configuration routes
and callback forwarding to a test-only mock passed. The mock was stopped.
These checks remain setup evidence; no genuine Linear event was delivered.
The new app is not yet created or authorized, and its worker remains stopped.
Existing production integration settings were not changed. Current form values,
resume commands and endpoint checks are in `linear55-new-app-setup.md` and
`linear55-new-app-checks.json` in the factory evidence directory.

## Genuine Linear delivery completed (2026-10-06)

The human created the private app as **Bobs Dummy Test**, saved its credentials,
and replied Ready. The original quick tunnel had expired. A fresh receiver used
`https://telecom-scripts-award-accessible.trycloudflare.com`; the app's callback
and webhook paths were saved as `/callback` and `/linear-webhook`, respectively.
The webhook field initially contained `/callback`, which was corrected before
testing. The isolated CLI OAuth flow completed, and the installed SDK identified
the token's actor as `1b82ff17-5875-4e02-9eac-3b81424e0957`, **Bobs Dummy Test**.
No existing integration token or webhook setting was substituted or changed.

The preserved implementation ran through
`bun run node_modules/.cache/workflow55-linear/new-app-worker.mjs`, with separate
home `/Users/jappy/.cyrus/linear55-test`, webhook port 3624 and dashboard 3625.
The public gateway verified Linear signatures and allowed only the two test
issues in workspace `9efe0176-e907-41d4-8718-7ffc6d482f74`. It exposed neither
dashboard nor configuration routes. These are actual external Linear deliveries,
not CLI fixtures or calls to `handleWebhook`.

Eleven created events and two prompted events arrived between 14:01:25 and
14:05:19 UTC. Six native sessions were accepted (five graph runs and one Simple
session); five selections were rejected without graph runs or fallback startup.
The dummy repository has no remote, so initial worktree setup warned about
`git fetch origin` and correctly used local `main`.

| Scenario | Exact selection input / native session | Observed result |
| --- | --- | --- |
| Delegation with saved default | ATT-1134, no selector or labels; `926d0b00-e9ef-4f09-802f-3bfa609b9ef2` | Completed `origin-probe`, source `default`; completion response returned to that Linear session. |
| Delegation with escaped description selector | ATT-1135 description `\[workflow=answer-probe\]`; `7270655b-a454-4b98-8629-db0beefca9d3` | Real Codex runner asked the test question. Snapshot retained historical comment `9ece5433-51fd-4159-8832-b70561d88cdb` and the readable attachment manifest. |
| Mention while original run was active | `@Bobs Dummy Test [workflow=origin-probe]`; `3c5809fa-d629-4ed8-a2d5-3dd1bd39cb5c` | Rejected with the original active run ID and guidance to reply there or stop it. |
| Answer from the original Linear thread | Parent `e4c1e49a-019c-4d0d-ba2d-562f8cfb5e0b`, reply beginning `Blue. BOB55-ANSWER-1` and containing inline-code `[workflow=unknown]` | Native activity `02d80c43-b329-4434-925e-09f377bfbb2e` recorded one answer. Same run completed with unchanged workflow and origin; question and completion responses returned to Linear. |
| Later mention overrides lower-source conflict | ATT-1134 description `[workflow=answer-probe] [workflow=simple]`; comment `@Bobs Dummy Test \[workflow=origin-probe\]`; `63650a9e-12a4-4f0a-8188-a7877bcd9e21` | Completed `origin-probe`, source `comment-selector`; original `BOB55-COMMENT-WINS` instructions remained in its input. |
| Unknown, disallowed and malformed selection | Comments `[workflow=unknown]`, `[workflow=factory-pipeline]`, `[workflow=]`; sessions `efdbfc7e-7d1e-4c59-8ea2-3dafdd8a7024`, `93823111-2cce-4704-8a81-a55fa8f79678`, `3818187b-45c6-47be-a7b2-0d0799ebb70e` | Each received its specific rejection response in Linear. Receipts were settled and no corresponding graph run existed. |
| Configured label | ATT-1134, no description/comment selector, label `workflow:probe`; `5ff704dc-e65a-4c7f-997b-d4606072ec45` | Completed `origin-probe`, source `label` with exact label recorded. |
| Native run restart and UI stop | Mention `[workflow=answer-probe]`; `bdfdac59-14a9-40bb-ae0e-83245fed448e` | Graceful worker restart preserved ID, origin, history and waiting question. Browser Stop and its confirmation produced persisted `stopped` status and a stopped response in the correct Linear session. |
| Simple question and follow-up | ATT-1134 comment `[workflow=simple]`; `e43373a8-8dc0-4287-8513-92cffe17ca05` | Real Codex runner answered with issue/project context. Follow-up in the original comment thread included a plain `[workflow=unknown]`; same native and runner session continued and returned `Selected workflow ID: simple` to Linear. |
| Winning-source conflict | Comment `[workflow=origin-probe] [workflow=simple]`; `076c3c88-7d3f-4440-b5b1-96d23f7b644c` | Specific conflicting-selector response, settled receipt and no graph run. |

Full exact descriptions, comments, native identities, timestamps and original-body
digests are in `linear55-new-app-genuine-deliveries.jsonl` in the factory evidence
directory. Email and avatar fields were removed; the body digests refer to the
original signature-verified bytes. `linear55-genuine-activity-receipts.json` and
`linear55-genuine-conflict-receipt.json` record responses read back from Linear.
Graph snapshots, before/after restart snapshots and
`linear55-genuine-provenance.json` contain the persisted outcomes and compact
source/build fingerprints. The served dashboard bundle matched the built bundle.

Separately, two captured native events were replayed **locally** through the
signature-checking worker after restart: the completed default launch and the
clarification answer. Both returned 200, created no replacement graph run, and
left the original answer count at one. This is controlled replay evidence, not
additional genuine delivery. See `linear55-native-replay-checks.json`.

The graph origin probe is script-only; the answer probe and Simple flow use the
real configured Codex runner. Native tickets have fewer than 100 comments or
attachments. Multi-page context, concurrent arrivals and detailed quote grammar
remain covered by the earlier scoped F1 drive and automated checks, rather than
being claimed as native multi-page or concurrency coverage. No full development
pipeline, PR publication or deployment was exercised.

`agent-browser --session linear55` inspected the built dashboard at desktop and
390×844 widths. Screenshots were visually inspected; origin text, source links,
answers, restored questions, stop state and Simple follow-up were readable, and
the browser reported no errors:

- [Native assignment answered in Linear](assets/workflow-selector-55/linear55-genuine-answer.png)
- [Restored mention waits with its original origin](assets/workflow-selector-55/linear55-genuine-restored.png)
- [UI stop of the restored native run](assets/workflow-selector-55/linear55-genuine-stopped.png)
- [Narrow stopped-run layout](assets/workflow-selector-55/linear55-genuine-mobile.png)
- [Simple follow-up keeps its workflow](assets/workflow-selector-55/linear55-genuine-simple-followup.png)

Product code was unchanged during this resume. The prior full package, final
worker, typecheck, build and Biome receipts were inspected and remain applicable.
`git diff --check` passed after updating this report. Test issues were undelegated
and unassigned. The separate test app's webhook delivery was disabled before its
worker, gateway and tunnel were stopped; ports 3623–3626 have no listeners.
Test resources, private credentials and review evidence remain available for
later reuse. Existing integration settings were untouched. No PR was created,
published, marked ready or merged.
