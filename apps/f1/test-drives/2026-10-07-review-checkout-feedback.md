# Review Guide checkout simplification

Date: 2026-10-07. Tested `72fb2f66747a8e154de08238c2bf2c339d6ad09b` plus the human-feedback delta committed with this report. PR: [#28](https://github.com/Attraccess/bobs-factory/pull/28).

## Scope and fixture

F1 applies to the changed Review Guide presentation and browser copy actions. The human rejection replaces the previously accepted commands with `gh pr checkout <pr-number>` and `git checkout <branch>`, and requests indication icons. The new menu shows only the exact commands and copy icons; successful clipboard writes show a checkmark and “Copied” on the trigger, with the existing toast. Unusual branch names retain literal POSIX shell quoting. Header metadata, verified-ticket handling and manual-copy recovery remain intact.

Fresh repository: `/tmp/factory-header-feedback-20261007`. Worker home: `/tmp/factory-header-feedback-home-20261007`. This uses the rebuilt compiled EdgeWorker, CLI tracker, real dashboard API, SSE and pending human-review gate, with the existing deterministic `review-header` workflow fixture. Ports: UI 3593, RPC 3600, fixture controls 3594. The fixture scripts live in the evidence directory below. No production ticket, provider checkout or merge was executed.

```sh
pnpm typecheck
pnpm build
pnpm --filter cyrus-edge-worker test:run test/FactoryReviewContext.test.ts test/FactoryReviewState.test.ts test/FactoryReviewFeedback.test.ts test/FactoryWebClient.test.ts
pnpm exec biome check packages/edge-worker/src/factory/web/review-context.ts packages/edge-worker/src/factory/web/review-context-row.tsx packages/edge-worker/test/FactoryReviewContext.test.ts
pnpm exec biome check packages/edge-worker/src/factory/web/styles.css
git diff --check
apps/f1/f1 init-test-repo --path /tmp/factory-header-feedback-20261007
node <evidence-directory>/feedback-fixture-20261007.mjs
CYRUS_PORT=3600 apps/f1/f1 ping
CYRUS_PORT=3600 apps/f1/f1 create-issue --title 'Simplified checkout menu feedback' --description 'F1 fixture for command copying and icon feedback.' --labels 'workflow:review-header'
CYRUS_PORT=3600 apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3600 apps/f1/f1 view-session --session-id session-1 --limit 8
node <evidence-directory>/feedback-browser-20261007.mjs copy
node <evidence-directory>/feedback-browser-20261007.mjs narrow
CYRUS_PORT=3600 apps/f1/f1 stop-session --session-id session-1
agent-browser --session factory-header-feedback close
```

## Results

- Root typecheck/build passed, including rebuilt factory web assets. All 31 focused tests passed. Changed TypeScript Biome checks and diff whitespace checks passed; CSS checks passed with existing stylesheet warnings.
- DEF-1/session-1 routed to the isolated repository. Initial and routing activities remained readable; the workflow reached a real pending review gate.
- All 20 focused `agent-browser` assertions passed. Both displayed commands copied exactly through successful native clipboard writes: `gh pr checkout 59` and `git checkout feature/review-header`.
- Copy icons are visible in both menu items. A successful click displays the trigger checkmark, “Copied” and command-specific toast. The indication resets after 2600ms. A deferred write shows no success before resolution.
- Clipboard denial exposes the exact focused, fully selected command without a success checkmark. A successful retry removes recovery.
- The long adversarial branch stays shell-quoted literally. The menu fits 390×844 dark and 320×720 light viewports without horizontal document overflow. Keyboard Enter/ArrowDown/Enter copies the Git option; Escape returns focus to the trigger.
- A real SSE update retains the reader node and open-menu focus. History, review gate, human decisions and ticket synchronization receipts remain unchanged after copying and the harmless refresh; browser interactions issue no mutation requests.
- PR-only and branch-only variants expose exactly their supported simplified command. Absent metadata omits copying.

Screenshots were saved and visually inspected: `feedback-desktop-light-menu.png`, `feedback-desktop-copied.png`, `feedback-mobile-dark-menu.png`, and `feedback-clipboard-fallback.png`. The previously recorded observation `qa-o1-mobile-context-overlap` is retained as historical feedback; the new 390px capture shows repository and revision above the open, smaller menu. This is delta verification, not a new approval or replacement of previous review dispositions.

Evidence directory: `/Users/jappy/.cyrus/factory/evidence/manual-443dc98d-6c88-43b6-a340-3b930a4dce9e`. Assertion results, before/after runtime receipts, build/typecheck/CSS logs and reproduction scripts remain there. Initial harness attempts incorrectly selected an unrelated screenshot status and reused a wrapped clipboard when opening the same URL; explicit reload and a toast-specific query corrected those harness issues. The final complete runs passed.

## Limits and cleanup

Provider metadata and clipboard denial/deferred writes are fixtures. Successful native write arguments were recorded; clipboard readback was not independently inspected. Logical viewport emulation does not establish physical-device behavior. The simple commands assume the relevant local clone and available branch; command execution was deliberately outside this copy-only validation. The fixture tracker retains its missing `in_review` state synchronization gap; no production ticket synchronization is claimed. There is no originating ticket for this manual task.

Synthetic ticket references were cleared before cleanup. The session stopped without a human decision, the named browser closed, and the worker stopped via SIGTERM. Test repositories and evidence remain for reproduction. Historical F1 reports and review decisions are preserved.
