# Humming along retains creation order

Date: 2026-10-05. Taskbot bobs-factory #67.
Tested revision: `7b9be55260ea7b09aa04b199276cae43f3c30d7d` plus the
working-list comparator change (source blob
`9b6fa8601351f018efab373495ddc85da68b60c2`).

## Isolated live scenario

This dashboard rendering change requires F1/browser validation. A fresh F1
repository and temporary Cyrus home exercised ticket routing, script execution,
persisted activities, the dashboard API and real SSE refreshes. No production
tracker, repository or agent session was modified.

Setup:

```sh
pnpm install --frozen-lockfile
pnpm build
apps/f1/f1 init-test-repo --path /tmp/humming-order-drive-e745294f
CYRUS_REPO_PATH=/tmp/humming-order-drive-e745294f CYRUS_PORT=3600 \
  CYRUS_FACTORY_PORT=3491 bun run apps/f1/server.ts
CYRUS_PORT=3600 apps/f1/f1 ping
```

Through Recipes, added `order-fixture`, matched by `workflow:order`, permitting
only `ticket-assignment`. Stock recipes and the saved Simple default remained
intact. Its two script steps, `stream` and `progress`, ran
`node /tmp/humming-stream-e745294f.mjs 1` / `2`. The script derives its run name
from `FACTORY_INPUT_FILE`, waits for a per-run phase file, and streams one
activity per second from Oldest when the `burst` gate exists.

Created issues titled `Order Oldest`, `Order Middle`, `Order Newest` and later
`Order Fourth` using `create-issue --labels workflow:order,primary`, then
`start-session --issue-id issue-N`. DEF-1/2 initially lacked `primary` and
requested repository selection; `prompt-session --session-id session-N
--message 'F1 Test Repository'` completed that selection. All four selected the
script recipe by label. The fixture repository has no remote, so expected fetch
warnings fell back to its local `main` branch.

Assertions through the isolated `agent-browser` session at 1280 × 1000:

- Three running workflow rows displayed Newest → Middle → Oldest. Their
  creation times were `13:41:47.286Z`, `13:41:43.758Z`, `13:41:43.754Z`.
- Expanded Oldest, opened the `burst` gate, and observed its latest activity
  changing from “phase 1 started” to numbered progress updates. All 33 observed
  DOM updates before Fourth arrived retained the three-row order.
- Opening `Oldest-1` advanced its step to Progress checkpoint, showing 1 of 2
  steps completed. It remained last and expanded, with the same row DOM node.
- Fourth entered first. Another 24 observed DOM updates retained Fourth →
  Newest → Middle → Oldest, with expansion still attached to Oldest.
- A visibility-change cycle closed/reopened the actual SSE connection; browser
  request records show a second successful `/api/events` request. Queries and
  activities refreshed without changing order or expansion. An offline/online
  cycle was also exercised; the explicit SSE request is the reconnect evidence.
- At the API snapshot, Oldest had the newest activity timestamp
  (`13:42:46.957Z`), later than Fourth (`13:42:46.460Z`), but remained last.
- Stopping Middle removed it without moving the others. Completing both Newest
  gates moved it to For you; settling that card moved it to Settled. The remaining
  order was Fourth → Oldest before and after a page reload. Settled contained
  Middle (Stopped) and Newest (Settled by you); For you was empty.
- No browser page errors. All isolated sessions were stopped and the F1 server
  and owned browser sessions were shut down after validation.

## Supplemental browser API fixtures

Six checks used browser-only `/api/runs` response routing against the built
dashboard: mixed workflow/ordinary sessions, reversed response order, an ordinary
session activity refresh, removal of a tied row, its return, and reload after
return. These are controlled presentation fixtures, not additional live agents.

Two workflow rows shared a creation timestamp, with B's activity newer than A's;
both response orders displayed A → B by ascending immutable ID. Ordinary sessions
used `active` status and omitted `updatedAt` initially. All checks displayed
ordinary newest → tied A → tied B → ordinary oldest, except while A was absent.
Changing the oldest ordinary session's activity timestamp did not move it.
Returning A restored its creation/ID position. A waiting question and stopped
row remained excluded from Humming along, with For you 1 and Settled 1 throughout.
No browser page errors. Live expansion and step progress were tested separately
above; the API fixtures do not validate ordinary agent execution or backend
timestamp persistence.

## Checks and evidence

- `pnpm --filter cyrus-edge-worker test:run test/FactoryWebClient.test.ts test/FactoryServer.test.ts`:
  2 files / 9 tests passed.
- `pnpm exec biome check packages/edge-worker/src/factory/web/app.tsx`: passed.
- `pnpm build` and `pnpm typecheck`: passed across the workspace.
- `git diff --check`: passed. Application diff is confined to the working-list
  comparator; the other changes are the changelog and this evidence report.

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-23a6210f-69a1-4c45-8c52-8c9fe745294f`.
Visually inspected `humming-before-updates.png` and `humming-after-updates.png`
show the same order/expanded row with changing activity; `humming-membership.png`
shows the fourth run, completed attention card and stopped settled row.
`humming-tied-fixture.png` shows the supplemental tied/mixed list.
`live-browser-checks.json` contains 57 observed updates and query fetches;
`live-runs.json`, `live-sse-requests.txt`, `live-membership-checks.json`,
`fixture-runs.json` and `fixture-browser-checks.json` retain the concrete
assertion data. Script/recipe and build/test/typecheck logs accompany the images.

Initial checks could not find dependencies in this new worktree. Installing the
unchanged lockfile resolved that setup issue; the checks listed above then passed.
