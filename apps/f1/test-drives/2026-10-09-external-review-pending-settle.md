# Keep pending ticket tracking in attention

Date: 2026-10-09

Validated base `2d0767f24a581e1036d45af791457c676b056baf` plus this
commit's review action changes, using web bundle `b92b270c802e772fec088dd6`.

An isolated EdgeWorker/Taskbot fixture used simulated agents (`F1_AGENT_MODE=mock`
and injected `MockAgentRunner`). After verified external work was accepted, the
fixture denied the Done update. The ticket remained In Review with a saved
tracking error. Headless browser checks at 1280×900 and 390×844 confirmed:

- The saved error and unfinished-tracking explanation remain visible.
- Settle is absent, while Reverify ticket changes remains available.
- A successful tracking retry moves the fixture ticket to Done, clears the
  warning, and restores enabled Settle.

All three screenshots were inspected. Evidence is retained under
`/Users/jappy/.bobs-factory/factory/evidence/manual-974e31ba-750c-4015-8170-e3856b56c26c/qa95-settle-fix/`:
`fixture.ts`, `prepare.mjs`, `browser.mjs`, `prepared.json`, `browser-result.json`,
`recovery-result.json`, and desktop/narrow failure and recovery PNGs.

Commands: rebuild with `node packages/edge-worker/scripts/build-factory-web.mjs`;
launch the fixture with `env -u BOBS_FACTORY_INTERNAL_EXECUTABLE`,
`F1_AGENT_MODE=mock`, `BOBS_FACTORY_DISABLE_REMOTE_SESSION_STORE=1`,
`BOBS_FACTORY_FACTORY_PORT=46995`, and `NODE_EXTRA_CA_CERTS=<fixture>/cert.pem`.
Run `bun <fixture>/fixture.ts <fixture>`, then the prepare and browser scripts.
Playwright ran explicitly headless. A fresh agent-browser session also inspected
this protected review route, explicitly started with `--headed false`.
An additional fixture patch retained an undelivered receipt without an error;
the saved `pending-receipt-snapshot.txt` confirms Settle is absent there too.
The named browser session and fixture were closed after verification.

68 existing TicketDelivery, TicketTracking, FactoryReviewState and
FactoryReviewFeedback tests passed. EdgeWorker/server/web TypeScript checks and
web build passed. No real agents, production tracker or passkey enrollment were
used. The fixture's first launch used the default occupied port; the corrected
isolated environment launched successfully. The first prepare command omitted
the fixture certificate; adding its isolated CA allowed preparation to succeed.
