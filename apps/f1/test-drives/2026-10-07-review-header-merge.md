# Review Guide integration after merging main

Date: 2026-10-07. Tested merge `f6de507290f0c727c5d64b916d6273b5ac0217c0`, combining Review Guide head `3e96d14a` with base `f7df4c36`. This report is the only subsequent delta. PR: [#28](https://github.com/Attraccess/bobs-factory/pull/28).

## Scope

The merge-readiness receipt reported a merge conflict and no failing CI checks or unresolved PR comments/threads. Fetching main and merging it exposed one changelog conflict; both the Review Guide and machine-capacity entries were retained. Review Guide code is unchanged, and its stylesheet additions compose with the base's recipe and queued-message styles. F1 was replayed to check the existing header/copy workflow against the combined runtime and rebuilt web assets, preserving previous human feedback and review dispositions.

## Checks and results

- Focused FactoryReviewContext, FactoryReviewState, FactoryReviewFeedback, FactoryWebClient and FactoryServer tests: 46 passed.
- Required commit hooks passed: staged Biome, root build, root typecheck and generated-schema consistency. The four Review Guide TypeScript files also passed explicit Biome checks; CSS passed with 16 retained warnings.
- `git diff origin/main --check` passed. Comparing the merged base against the old head also exposed two pre-existing Markdown hard-break whitespace lines in a base F1 report; those historical lines were retained.
- Fresh F1 repository `/tmp/factory-header-merge-20261007`, worker home `/tmp/factory-header-merge-home-20261007`, UI 3593, RPC 3600 and fixture control 3594. The rebuilt EdgeWorker used the existing deterministic `review-header` fixture. DEF-1/session-1 routed to its worktree, posted readable initial/routing activities and reached the real pending human-review gate.
- All 20 agent-browser assertions passed: exact native clipboard write arguments for both commands, copy icons/checkmarks, deferred-write timing, denial/manual-selection/retry, literal quoting, 390px dark and 320px light layout, keyboard activation/Escape focus, reader/menu identity across SSE, unchanged review/tracking receipts, no mutation requests, and PR-only/branch-only/absent metadata.
- Desktop and mobile screenshots were visually inspected. The first narrow-phase attempt found an empty browser session at `about:blank`; explicitly reopening/reloading the page and installing fresh browser instrumentation made that phase independent of session retention. No product code changed for this harness correction.

## Reproduction and evidence

From the repository root:

```sh
pnpm --filter cyrus-edge-worker test:run test/FactoryReviewContext.test.ts test/FactoryReviewState.test.ts test/FactoryReviewFeedback.test.ts test/FactoryWebClient.test.ts test/FactoryServer.test.ts
apps/f1/f1 init-test-repo --path /tmp/factory-header-merge-20261007
node <evidence>/feedback-fixture-20261007.mjs
CYRUS_PORT=3600 apps/f1/f1 ping
CYRUS_PORT=3600 apps/f1/f1 create-issue --title 'Review Guide merge integration' --description 'Isolated F1 replay after resolving changelog conflict against main.' --labels 'workflow:review-header'
CYRUS_PORT=3600 apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3600 apps/f1/f1 view-session --session-id session-1 --limit 8
node <evidence>/feedback-browser-20261007.mjs copy
node <evidence>/feedback-browser-20261007.mjs narrow
CYRUS_PORT=3600 apps/f1/f1 stop-session --session-id session-1
agent-browser --session factory-header-merge close
```

Evidence directory: `/Users/jappy/.cyrus/factory/evidence/manual-443dc98d-6c88-43b6-a340-3b930a4dce9e/merge-validation-20261007`. It retains fixture/browser scripts, assertion results, before/after receipts, logs, and `feedback-desktop-light-menu.png`, `feedback-mobile-dark-menu.png`, `feedback-desktop-copied.png`, and `feedback-clipboard-fallback.png`.

## Limitations and cleanup

Provider metadata, denied/deferred writes and guide content are fixtures. Successful native write arguments were recorded; independent clipboard readback, provider command execution and physical-device behavior were not checked. The fixture repository has no origin and used local main. Its tracker retains the missing `in_review` state synchronization gap; no production ticket synchronization is claimed. This manual task has no originating ticket.

Synthetic ticket metadata was cleared. Session-1 stopped without a human decision, the named browser closed and the worker received SIGTERM. No provider approval, PR merge or ready transition was performed. Prior evidence and decisions remain intact.

## Concurrent base update

After pushing the validated merge, main advanced to `03eb2365` (marketing website PR #29). A fresh fetch and second merge applied that update cleanly. Its separate `website/` and Pages workflow do not change the tested Review Guide runtime or web sources. The only new task-owned delta is this report clarification; the integration results above remain applicable. Required commit hooks run again on the final merge.
