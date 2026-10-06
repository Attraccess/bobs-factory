# Run title timeout recovery

Date: 2026-10-06. Tested `96fdf452ef7f6f3755f079f75c80bb985e51994f` plus the local title timeout/retry changes.
F1 applies: auxiliary runner lifecycle, persisted naming state and dashboard behavior change.

## Fixture and assertions

Fresh F1 repository `/tmp/f1-title-timeout-repo-20261006`, isolated home
`/tmp/f1-title-timeout-20261006`, RPC port 3642, dashboard port 3641.
The worker uses the built EdgeWorker, CLIIssueTrackerService and LinearActivitySink.
Naming uses authenticated native Codex. The first naming configuration is deliberately
held beyond a 30-second fixture deadline; the retry receives 60 seconds. Production
uses 60 seconds followed by 120 seconds. Another fixture injects a non-timeout provider
error before a manual retry. No production tickets or publication steps run in F1.

```sh
./apps/f1/f1 init-test-repo --path /tmp/f1-title-timeout-repo-20261006
bun /tmp/f1-title-timeout-20261006/worker.mjs
CYRUS_PORT=3642 ./apps/f1/f1 ping
CYRUS_PORT=3642 ./apps/f1/f1 create-issue --title 'Explain stable inventory counters' --description 'Explain why an inventory counter should remain stable across successive scans. Reply with one short sentence. Do not edit files, implement anything or publish a PR.'
CYRUS_PORT=3642 ./apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3642 ./apps/f1/f1 view-session --session-id session-1 --limit 30 --offset 0
```

## Results

- `session-1`: the first title configuration times out; a second configuration
  generates **Explain Stable Inventory Counters** using `gpt-6-luna`/low.
  The saved naming job is completed with `retries: 1`. Primary execution posts
  its own final response among eight activities; naming messages do not appear there.
- Manual script run `manual-f7c42e59-8f21-4c60-9b22-eb88e5523859`:
  injected provider failure remains visible with **Retry title** in the browser.
  Changing title settings to `gpt-6.1-sol`/low and clicking that button shows
  **Generating title…**, then **Explain Inventory Scan Consistency**, through live
  updates. Status, history, outputs, workspace and trigger origin remain identical
  before and after naming retry.
- Graceful fixture restart retains both exact titles and naming job snapshots.
  Four total configuration records remain unchanged: two for the automatic
  retry scenario, one failed manual attempt and one successful manual retry.
  Completed naming jobs do not restart.
- Protected API tests reject unknown runs, unprotected requests and duplicate
  retries. Unit checks enforce the saved retry budget across restarts and reject
  late startup results after deadline cleanup.

Fixture JSON snapshots, title configuration records and worker logs are retained
under the isolated home above. The browser failure state was visually inspected
at 1280×800. The fixture worker was stopped after validation.

## Checks and live repair

Seven relevant suites pass: **123 tests**. The final targeted generator/worker
rerun passes **37 tests**. Core build, EdgeWorker type checks (including web),
EdgeWorker build, changed TypeScript Biome checks and `git diff --check` pass.
CSS checking reports the existing descending-specificity warnings.

After validation, the local Cyrus service was gracefully restarted. Clicking
**Retry title** on the reported run
`manual-26972218-5a1c-4005-ac60-269687696365` uses the current `gpt-6-luna`/low
settings and completes with **Implement Guided PR Review Guide**. This was
verified in persisted state and the live dashboard. Its workflow remains in
clarification; naming does not submit answers or restart execution.

Live native coverage is Codex. Cancellation, exhausted retry budgets, stale
startup results and other provider-error paths use deterministic tests.
