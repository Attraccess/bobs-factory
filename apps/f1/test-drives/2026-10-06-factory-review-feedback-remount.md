# Pending review feedback survives route remounts

Date: 2026-10-06. Finding: `review-feedback-remount-lock` on draft PR [#15](https://github.com/Attraccess/bobs-factory/pull/15).
Tested `7182022ae52e05e923488093a44763c65c73b512` plus the fix in `review-feedback-session.ts`, `review-comments.tsx` and `focus.tsx`, using freshly built dashboard assets.

## Applicability and setup

F1 applies because this changes persisted human-review interactions during a pending rejection. This focused follow-up preserves the original feedback drive report and validates only the changed request/remount lifecycle.

Fresh repository: `/tmp/factory-review70-remount-drive`; worker home: `/tmp/factory-review70-remount-fixture`. Dashboard: 3530; RPC: 3620; fixture controls: 3531. Port 3600 was already occupied, so the fixture used 3620. The compiled EdgeWorker, CLI issue tracker, real dashboard APIs/SSE, pending human gates and rejection branch were exercised. The guide and human-fix hook were deterministic, harmless fixtures adapted from the earlier #70 drive. Title naming was suppressed; no provider execution or remote mutation was needed.

Commands:

```sh
pnpm typecheck
pnpm build
apps/f1/f1 init-test-repo --path /tmp/factory-review70-remount-drive
node <evidence>/remount-fixture.mjs
CYRUS_PORT=3620 apps/f1/f1 ping
CYRUS_PORT=3620 apps/f1/f1 status
CYRUS_PORT=3620 apps/f1/f1 create-issue --title 'Pending review remount' --description 'Delayed rejection, leave and return, preserve lock and drafts.' --labels workflow:review70
CYRUS_PORT=3620 apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3620 apps/f1/f1 view-session --session-id session-1 --limit 8
# A second issue/session tests an unrelated feedback identity.
agent-browser --session remount70 open http://127.0.0.1:3530/#/runs/session-1/review
python3 <evidence>/remount-drive.py
python3 <evidence>/remount-continued.py
CYRUS_PORT=3620 apps/f1/f1 stop-session --session-id session-2
agent-browser --session remount70 close
```

## Assertions and results

- Added one item comment and general feedback. Held the rejection response, navigated to Today and returned through the client router without reloading. The returned editor, submit action and competing decisions remained disabled. Exactly one request had been issued and no runtime decision existed.
- Released an injected delayed HTTP 409. The complete draft survived, the returned editor unlocked, and editing worked again. No decision or human-fix execution occurred.
- Submitted again with a delay before forwarding to the real API. Repeated leave/return navigation. The pending lock survived; final-page approval was disabled. A different run's existing draft remained editable and unchanged.
- Simulated another tab changing the pending review's localStorage item comment and general feedback before completion. Released the real rejection. Exactly one decision and one human-fix invocation received the identical submitted feedback, rather than the later edits.
- New unsent item/general edits survived successful completion in storage, the currently rendered form and a subsequent leave/return. The unrelated run's draft remained unchanged.
- Desktop (1440×1000) and mobile (390×844) screenshots were captured and visually inspected. Existing layout and disabled controls rendered correctly. CLI activities remained readable. The browser and isolated worker were stopped; the remaining pending session was explicitly stopped first.

The browser script initially stopped on a malformed quoted selector after the pending/failure checks passed. The selector was corrected and the remaining assertions completed against the same delayed request; the captured receipt records the successful continuation. No product failure was masked by restarting the scenario.

## Checks and evidence

- Focused tests: 82 passed across `FactoryReviewState`, `FactoryReviewFeedback`, `FactoryWebClient`, `FactoryServer`, `WorkflowRuntime` and `Guide`. Four added regressions cover shared pending locks, failure recovery, snapshot-specific clearing/identity isolation and denied storage.
- `pnpm typecheck`, `pnpm build`, Biome for changed TypeScript/TSX/tests and `git diff --check`: passed.
- Evidence directory: `/Users/jappy/.cyrus/factory/evidence/manual-1ab8010c-0503-48fc-bdd8-92558d3f43d6`.
- Runtime receipt: `remount-runtime.json`. Fixture/automation: `remount-fixture.mjs`, `remount-browser-lib.py`, `remount-drive.py`, `remount-continued.py`.
- Visually inspected screenshots: `remount-pending-desktop.png`, `remount-pending-mobile.png`, `remount-preserved-edit-desktop.png`.

Limits: viewport emulation, deterministic guide and human-fix hook. The second-tab case changes storage directly; it does not launch a separate browser tab. Pending locks are scoped to live requests within the client, not persisted across a full document reload. No claim of production or provider behavior. The full monorepo test suite was not needed; relevant tests, types and builds passed. Historical evidence remains unchanged.
