# QA stories, screenshots, fix/retest and assistance recovery

Date: 2026-10-06. Task: [Bob’s Factory #74](https://taskbot.apps.janjaap.de/p/bobs-factory/t/74).
Tested implementation: uncommitted implementation based on
`96fdf452ef7f6f3755f079f75c80bb985e51994f`.

## Changed behavior and applicable coverage

F1 applies to the expanded Factory QA contracts, gates, role context, durable
assistance checkpoints and evidence UI. Three isolated runs exercised the real
compiled EdgeWorker, CLI issue tracker, factory-context MCP, native Codex
`gpt-6.1-sol` QA execution and native QA/image review. Scope, code review, CI,
fixer and guide used deterministic fixture receipts. The actual factory gates,
result validation, revision stamps, evidence verification and recovery runtime
were used. The guide ended the fixture pipeline; external PR delivery, human
approval and merge were not exercised.

Fixture source, isolated repository, bare origin, worker, receipts and logs are
under `node_modules/.cache/qa-drive/`. Factory UI: 3626; F1 RPC: 3627; save-record
application: 3628. The fixture CLI emits JSON for record 42. Its browser Save
action initially fails; the fixture fixer changes `behavior.json`, commits that
fix, and returns through code review and CI to fresh native QA.

## Launch and execution

```sh
node node_modules/.cache/qa-drive/worker.mjs
CYRUS_PORT=3627 apps/f1/f1 ping
CYRUS_PORT=3627 apps/f1/f1 create-issue --title 'QA nonvisual CLI' --description 'Execute a real CLI save criterion with zero selected images.' --labels factory
CYRUS_PORT=3627 apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3627 apps/f1/f1 create-issue --title 'QA UI fix and retest' --description 'Execute the UI save story, detect the seeded failure, fix, retest and inspect its selected screenshot.' --labels factory
CYRUS_PORT=3627 apps/f1/f1 start-session --issue-id issue-2
CYRUS_PORT=3627 apps/f1/f1 create-issue --title 'QA assistance restart' --description 'Block the CLI save criterion until the fixture account is restored through an answer.' --labels factory
CYRUS_PORT=3627 apps/f1/f1 start-session --issue-id issue-3
```

Issue creation and session launch passed. Coherent tracker activities appeared
before restart, including native tool actions and assistance. Durable Factory
history and events were inspected throughout the subsequent runs.

- **DEF-1/session-1, CLI:** the native QA agent actually executed
  `node cli.cjs save`, parsed stdout, checked exit 0, numeric `id:42`, and
  `saved:true`. Native review verified the receipt and clean current revision.
  Zero images were selected or supplied. The QA gate approved and the guide
  mapped the command evidence to the accepted requirement.
- **DEF-2/session-2, UI:** capture outcomes were blocked → failed → passed.
  Once browser access was available, native QA clicked Save and recorded the
  visible product failure. Consequential findings prevented the guide. History
  confirms `visual-fix → code-review → review-gate → ci → visual-scope → capture`.
  Fresh browser QA after the committed fix saw “Saved record 42” and captured
  the selected image. Native review opened that PNG with `tools.view_image`,
  inspected its contents and accepted its exact SHA-256
  `cc58a152960176f68105b112fc6309ff22e7605d8662ee2b8ac1a75d95ec1f13`.
  The runtime recorded clean tested revision
  `a2847cb69e9f6593cd395fe40b409674a7225296`. The final gate approved; historical
  findings remained visible with resolved dispositions.
- **DEF-3/session-3, assistance:** the fixture required account-readiness
  confirmation. Native QA did not execute the restricted criterion and reported
  its concrete blocker. The gate waited for assistance. Graceful worker restart
  preserved identical questions, frozen definitions and the history prefix.
  An answer through the protected Factory answer endpoint confirmed readiness.
  Native QA read `/answers`, freshly executed the CLI criterion, and returned
  through native review and the gate in the same run. The final guide used the
  actual execution evidence; the answer itself was not evidence or approval.

Post-drive assertions against saved runtime snapshots passed: all three runs
completed with approved QA gates, every final criterion passed, tested revisions
were clean, nonvisual inventories contained zero images, the fix/retest ordering
was exact, the image acceptance hash matched, and assistance retained its single
answer and restart state. Snapshots are `final-1.json` through `final-3.json`,
`assistance-before-restart.json` and `assistance-after-restart.json` in the fixture
directory. Compact role outputs and outcome history are retained in
`qa-live-results-1.json` through `qa-live-results-3.json` in the supplied evidence
directory.

## Browser inspection

`agent-browser` opened the built Factory dashboard and inspected QA artifacts,
blocked evidence, the screenshot gallery and the human guide at desktop
1440×1000 and mobile 390×844. DOM checks verified the selected screenshot gallery
and useful zero-image reports. Screenshots were opened for pixel inspection.
The mobile reports keep criterion evidence and concrete blocked reasons readable.
The UI report retains resolved findings and its gallery below the criteria.

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-d28713cc-143c-4eb4-acb9-c1a095c39303`.
Relevant images: `qa-ui-report-desktop.png`, `qa-ui-report-mobile.png`,
`qa-ui-fixture-success.png`, `qa-blocked-desktop.png`, `qa-blocked-mobile.png`,
`qa-nonvisual-desktop.png`, `qa-nonvisual-mobile.png`, `qa-guide-desktop.png`,
and `qa-guide-mobile.png`.

![QA criterion evidence and retained findings](/Users/jappy/.cyrus/factory/evidence/manual-d28713cc-143c-4eb4-acb9-c1a095c39303/qa-ui-report-desktop.png)

## Setup issues and limits

An initial unignored `.claude` fixture directory made the isolated worktrees
dirty; the real gates correctly refused approval. The fixture ignore was added
and committed, then QA was executed again on clean revisions. Initial native
browser sandbox restrictions produced an assistance blocker. Only this isolated
fixture worker was configured with full local browser access before retry.

The CLI fixture tracker keeps issue/session records in memory. Worker restart
required restoring its three issue records; a temporary fixture comment-delivery
error was recovered with Retry. Factory checkpoints/history persisted. No claim
is made about production tracker delivery after restart. Native providers can
vary in their output; deterministic runtime tests cover malformed receipts and
unsupported recovery graphs in addition to these successful live paths.

The fixture did not test API behavior live; API-only evidence is covered by
targeted runtime tests. The guide was assembled from actual QA evidence by a
fixture adapter, so this drive validates its contract/rendering rather than
native guide generation. No production application or external PR was changed.
The fixture worker and browsers were stopped; agents cleaned up servers they
started.

Final follow-ups tightened saved-recipe customization/legacy handling and
avoided generating a duplicate failure when an open finding already covers the
same criterion. Those changes were verified by focused tests and build/types
after the live drive. The live snapshots intentionally retain their original
historical findings.

## Automated verification

- Focused Factory pipeline/runtime/web/incremental/server suites: 106 passed.
- Earlier broad edge-worker suite: 1,079 passed, one existing skip, 97 files.
  A later optional default-concurrency repeat stalled and was stopped with exit
  143; it is not counted as a passing run. A bounded repeat (`--maxWorkers=2`)
  reported one failure in the legacy recovery case before it was stopped with
  exit 130. It did not finish or provide a final failure trace. The unchanged
  recovery cases subsequently passed in isolation:
  `pnpm --filter cyrus-edge-worker test:run test/FactoryPipeline.test.ts -t
  'recovers missing visual evidence' --maxWorkers=1` (two passed, 26 intentionally
  skipped). No successful final full-suite repeat is claimed.
- Root `pnpm typecheck` and `pnpm build` passed. Latest affected package types
  and build also passed after the final follow-ups.
- Changed-file Biome and `git diff --check` were used for final source checks.
