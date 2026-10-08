# Specialist review with passkey-protected Factory access

Date: 2026-10-07. Tested the merge working tree of PR #32 head `f4c93ec6`
and main `9badbae6` (passkey access, PR #27), including the conflict resolutions
and authenticated Recipes QA helper in this commit. Both branches' changelog
entries and launch capabilities are retained. SR-001 through SR-004 and
QA-001/QA-002 remain settled; historical evidence is preserved.

## Applicable behavior and setup

F1 applies to the authentication and workflow integration. A fresh temporary Git
repository and Cyrus home served provider RPC on 3958 and protected Factory HTTP
on 3957. `F1_AGENT_MODE=mock` and `CYRUS_DISABLE_REMOTE_SESSION_STORE=1` were set.
Background titles were disabled. All agent attempts were intercepted by scripted
fixtures with production finalization and capacity leases; provider runner
creation used `f1AgentHandlers('mock')`. No native provider invocation, inference,
real tracker, publication or human approval occurred.

Expected: anonymous reads remain denied; authenticated specialist runs preserve
coverage, fixes and pending human decisions. Restart must retain their history.
Recipes focus checks must authenticate without weakening passkey protection.

Evidence:
`/Users/jappy/.cyrus/factory/evidence/manual-0b7cf77f-8296-4e61-9df5-b03561e59729/ci-r6/`.
`merge.patch` retains the tested merge delta. Drivers, HTTP assertions, complete
run records and browser command receipts are retained in that directory.

## Executed results

- Config, run and artifact reads without a session returned 401. An isolated,
  server-seeded fixture session authorized reads, activity and guide artifacts.
  This tests session gating, not a new WebAuthn ceremony.
- Issue/session flows executed all six configured specialists. The coverage
  fixture retained met R1 and R2 explicitly skipped by Alice's accepted D1.
- The fix fixture performed a corrective Git commit and actual Node input
  assertions, then a second review round. Resolved findings and guide coverage
  remained available. Both reviewed fixtures waited at human review without
  submitting an approval.
- Extraction recommendations remained waiting for explicit submission.
- Restart retained exact history, review rounds, pending questions and question
  batch identity for all three flows. No product configuration changed.
- The canonical Recipes helper loaded an authenticated test browser state into
  a fresh headless session. Pointer and keyboard checks at 1280×900 and 430×900
  verified exact opening-button focus after Escape, labelled controls, narrow
  scrolling and rejected JSON-off saves with unchanged configuration.
  `canonical-focus/focus-receipts.json` records the assertions and screenshots.
  This separate stock-recipes fixture disabled every agent/run launch.
- 1,475 edge-worker tests passed, one skipped, across 117 files. This includes
  authentication, routing prompts, specialist coverage, history and guides.
- The CLI suite passed 152 tests but timed out in ten existing release-fixture
  cases at Vitest's five-second default. Isolated serial execution of those two
  suites passed all 24 tests with a 30-second allowance. No release logic or
  timeout defaults were changed; the initial failures remain in `cli-tests.log`.
- Root build and typecheck passed. Biome CI passed with 29 existing warnings;
  changed-script syntax and Biome checks passed. Frozen install succeeded and
  `pnpm audit` reported no known vulnerabilities.

The initial exploratory driver attempts corrected instrumentation assumptions
about run creation timing, the guide artifact endpoint and absent review-round
arrays before extraction. Their logs remain retained; they are not passing
product evidence. The final `drive-receipts.json` and `restart-receipts.json`
record the verified scenarios.

Commands:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm biome ci
pnpm audit
F1_AGENT_MODE=mock pnpm --filter cyrus-edge-worker test:run
pnpm --filter cyrus-ai test:run
pnpm --filter cyrus-ai exec vitest run release-publish.test.ts test-release.test.ts --maxWorkers=1 --testTimeout=30000
F1_AGENT_MODE=mock bun EVIDENCE_DIR/worker.mjs
F1_AGENT_MODE=mock bun EVIDENCE_DIR/drive.mjs
node scripts/qa-recipes-focus.mjs http://localhost:3961 EVIDENCE_DIR/canonical-focus EVIDENCE_DIR/focus-auth-state.json
```

Both isolated servers and the named browser session were closed. The test-only
browser authentication file is private and untracked. These results establish
scripted orchestration and Chromium interaction. Real-model extraction/review
quality, physical passkeys, iPhone Safari and production tunnel behavior remain
unverified. Historical capacity-lock and iteration-limit incidents remain
recorded; supplied ticket-sync receipts are delivered. Fresh review and human
approval remain required for this revision. The PR remains draft and unmerged.
