# Today’s settlement shortcut waits for ticket tracking

Date: 2026-10-09. Validated base `24debd75cf9dddf8d987a9cb1505a98704d025fa`
plus this commit’s Today shortcut and run-list tracking summary changes.
Web bundle: `d411d3aa1626de254563ae87`.

F1 applies to ticket tracking recovery and dashboard actions. A fresh isolated
EdgeWorker and Taskbot fixture used injected simulated agents with
`F1_AGENT_MODE=mock`. Authorized edits were applied and independently verified,
then fixture human approval accepted the evidence. The final Done update was
intentionally denied, leaving the actual fixture ticket In Review.

Headless keyboard checks passed all 12 external, repository and mixed delivery
combinations with queued, failed, delivered and superseded tracking states.
Queued and failed tracking prevented settlement writes; delivered and superseded
tracking allowed them. These combinations used controlled browser responses.

The real fixture run-list API initially omitted tracking state. The shortcut guard
alone therefore failed the actual recovery check. The fix now returns compact
error and receipt flags, with a regression assertion that large receipt bodies
remain excluded. A fresh fixture run confirmed that `e` cannot save `settledAt`
while closure is blocked. After a protected tracking retry moved the ticket to
Done, `e` saved settlement and removed the run from Today’s attention. Task edits
and agent role counts stayed unchanged; no forge was invoked. Before discovering
the missing API state, one attempted test wait targeted text absent from Today;
the final check used a clean browser context and the saved API view state.

Evidence:
`/Users/jappy/.bobs-factory/factory/evidence/manual-974e31ba-750c-4015-8170-e3856b56c26c/qa95-keyboard-fix/`
contains `fixture.ts`, `prepare.mjs`, `keyboard.mjs`, `matrix-results.json`,
`keyboard-results.json` and inspected blocked/recovered Today screenshots.

Commands: `pnpm --filter bobs-factory-edge-worker build`; launch the isolated
fixture with `env -u BOBS_FACTORY_INTERNAL_EXECUTABLE`, `F1_AGENT_MODE=mock`,
`BOBS_FACTORY_DISABLE_REMOTE_SESSION_STORE=1`, `BOBS_FACTORY_FACTORY_PORT=46995`
and its isolated `NODE_EXTRA_CA_CERTS`, then run `bun <evidence>/fixture.ts
<evidence>`, followed by `node` on `prepare.mjs` and `keyboard.mjs` with the same
argument. Playwright explicitly used `headless:true`. A separate fresh
agent-browser session opened with `--headed false` and was closed after inspection.
The fixture was stopped after validation.

All 84 existing FactoryServer, TicketDelivery, TicketTracking, FactoryReviewState
and FactoryReviewFeedback tests passed, including the extended compact-response
regression. Package build, web TypeScript, formatting and whitespace checks passed.
Production trackers, real-agent behavior and actual forge delivery remain untested.
Earlier review and Run story evidence is retained; this drive covers the shortcut
and the run-list data it consumes.
