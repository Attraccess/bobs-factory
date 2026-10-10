# Run story settlement waits for ticket tracking

Date: 2026-10-09. Validated base `bf50f46cffb0eb3dbcf38d97baa9098199f81844`
plus this commit's Run story action change, web bundle `15c7e622665f19e2b2342a2c`.

F1 applies to the tracking recovery UI. A fresh isolated EdgeWorker and Taskbot
fixture used injected simulated agents with `F1_AGENT_MODE=mock`. It applied
authorized ticket edits, independently verified them, obtained fixture human
acceptance and denied the final Done update. No production tracker, forge or
real agent was invoked.

Headless checks covered completed external, repository and mixed guides with
queued, failed, delivered and superseded tracking receipts. All 12 combinations
passed: pending tracking withholds settlement in both review and Run story,
including keyboard tab order. Delivered and superseded controls restore it.
A matching pending human gate still offers enabled approval and rejection.
Desktop and narrow Run story screenshots were inspected.

The actual fixture tracking retry moved the ticket from In Review to Done,
cleared the warning and restored enabled Run story Settle. Clicking it saved
`viewState.settledAt` and showed Bring back. Ticket edit calls and agent role
counts were unchanged; forge calls were zero. The first recovery script checked
view state in the internal run rather than the API's combined run/view response;
the corrected script passed against a fresh run.

Evidence directory:
`/Users/jappy/.bobs-factory/factory/evidence/manual-974e31ba-750c-4015-8170-e3856b56c26c/qa95-story-fix/`.
It contains `fixture.ts`, `prepare.mjs`, `views.mjs`, `recovery.mjs`,
`views-extra-results.json`, `story-recovery.json` and inspected PNGs.

Commands: build with `node packages/edge-worker/scripts/build-factory-web.mjs`;
launch the fixture with `env -u BOBS_FACTORY_INTERNAL_EXECUTABLE`,
`F1_AGENT_MODE=mock`, `BOBS_FACTORY_DISABLE_REMOTE_SESSION_STORE=1`,
`BOBS_FACTORY_FACTORY_PORT=46995` and its isolated `NODE_EXTRA_CA_CERTS`.
Run `bun <evidence>/fixture.ts <evidence>`, then `node` on the prepare, views and
recovery scripts with the evidence directory argument. Playwright used explicit
`headless:true`; a fresh agent-browser session started with `--headed false`
also inspected the protected Run story. Both were closed after validation.

All 68 existing TicketDelivery, TicketTracking, FactoryReviewState and
FactoryReviewFeedback tests passed, as did web TypeScript, web build, formatting
and whitespace checks. Production permissions and real-agent behavior remain
untested. Existing backend drift/read safeguards were unchanged; prior evidence
is retained rather than replayed for this UI-only correction.
