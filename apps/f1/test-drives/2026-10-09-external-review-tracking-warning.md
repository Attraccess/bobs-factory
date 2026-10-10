# External review ticket synchronization warning

Date: 2026-10-09

## Changed behavior and revision

Validated the review warning fix on base `07d2343ad64bab8b30645d4cd88bd82eb24debeb`
plus this commit's review-page change. The rendered web bundle was
`f6d54839b444c44f74d93b6b`.
Completed review guides expose pending ticket synchronization and its saved error.
Approved work with unfinished tracking no longer claims full completion.

## Scenario and results

An isolated EdgeWorker and Taskbot fixture ran standard Factory with simulated
agents (`F1_AGENT_MODE=mock`, injected `MockAgentRunner`). After independent
verification and explicit fixture acceptance, the tracker rejected the Done update.
The workflow finished, the ticket stayed In Review, and tracking retained the error.

Headless Playwright checked the actual protected review route at 1280×900 and
390×844. Both checks passed:

- The error `Fixture completion status unavailable` appears in a visible alert.
- The page explains that approved work still needs ticket synchronization.
- The page does not say `The run is complete` during the failure.
- The Decide page retains `Reverify ticket changes`.

After restoring the fixture's Done operation, a tracking-only retry moved the
fixture ticket to Done. Reloading the review cleared the warning and restored the
normal completion notice. Both full-page screenshots were inspected.

## Commands and evidence

Evidence directory:
`/Users/jappy/.bobs-factory/factory/evidence/manual-974e31ba-750c-4015-8170-e3856b56c26c/qa95-fix/`

The directory retains `fixture.ts`, `prepare.mjs`, `browser.mjs`, `prepared.json`,
`browser-result.json`, `recovery-result.json`, and desktop/narrow screenshots
`qa95-sync-blocker-fixed.png` and `qa95-sync-blocker-fixed-narrow.png`.

Launch the fixture from the worktree with `env -u BOBS_FACTORY_INTERNAL_EXECUTABLE`,
`F1_AGENT_MODE=mock`, `BOBS_FACTORY_DISABLE_REMOTE_SESSION_STORE=1`,
`BOBS_FACTORY_FACTORY_PORT=46995`, and `NODE_EXTRA_CA_CERTS` pointing to its
fixture-only certificate. Run `bun run <evidence>/fixture.ts <evidence>`, then
`node <evidence>/prepare.mjs <evidence>` and `node <evidence>/browser.mjs <evidence>`.

Additional checks passed:

- 68 tests in TicketDelivery, TicketTracking, FactoryReviewState and
  FactoryReviewFeedback.
- EdgeWorker server/web TypeScript checks, web bundle build, Biome and whitespace.

## Limitations and cleanup

No real agents or production tracker were used. Browser authentication was seeded
in the isolated fixture; passkey enrollment was outside this fix. Agent-browser
started in a fresh explicitly headless session but stalled during inspection;
explicitly headless Playwright completed the checks. The CLI session was closed
and the fixture stopped after validation. The first source fixture launch inherited
an installed-binary internal executable setting and failed context startup;
unsetting it allowed the fresh run above to complete.
