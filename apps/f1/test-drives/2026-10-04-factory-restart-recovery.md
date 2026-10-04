# Factory submission feedback and restart recovery

**Date:** 2026-10-04  
**Tracked work:** Taskbot `bobs-factory` #16 / [PR #1](https://github.com/Attraccess/bobs-factory/pull/1)  
**Tested source:** baseline `d3ca5d7` plus this follow-up's working changes; final commit hooks verify the shipped build/types.  
**Repositories:** `/tmp/bobs-factory-resume-drive` (fresh F1 fixture)  
**Homes/ports:** `/tmp/bobs-factory-resume-check` (3473/3474), `/tmp/bobs-factory-resume-persistent` (3475/3476)

## Applicability and assertions

These changes affect session lifecycle, human clarification and UI input. F1
validation is required. The drive specifically checks saved unanswered questions,
agent conversation continuation, completed-step receipts, user-stop persistence,
and visible activity after a restart. Production Cyrus PID 22338 and its active
Takeover were never stopped or restarted.

## Scenarios and results

1. Created DEF-1 with label `workflow:restart-check`. The workflow runs a
   preparation script, a Codex clarifier, a Codex implementation fixture and a
   finalization script. Preparation/finalization each append one marker line.
   The clarifier asks for a color until a human answers. The work agent creates
   `work-once.txt` and sleeps; on continuation it inspects the existing marker
   and skips the sleep.
2. Gracefully stopped the first worker while waiting for clarification, then
   relaunched against the same home. The same question, empty answers and two
   receipts (`prepare`, `clarify`) remained. No clarification agent reran and
   no approval was invented. Submitted `Blue` via `/api/runs/session-1/answer`.
3. Stopped that worker during the real Codex work step and relaunched. The work
   conversation ID remained `01a108c6-9b8b-7ea3-bab2-009a34832fe1`; the resumed
   agent used the new context MCP connection. The run completed with exactly
   `prepare`, `clarify`, `clarify`, `work`, `finish` receipts. All marker files
   contained one line.
4. Repeated with a persisted CLI tracker fixture. Its `getState()` Maps and date
   fields are restored before EdgeWorker initialization, preserving the issue,
   comments, external agent session and activity history independently of the
   runtime being tested. After a clean clarification restart, submitted `Blue`
   and started a manual Simple diagnostic in a separate worktree. Killed only
   this fixture worker and its 18 descendants with SIGKILL, then relaunched.
   Both runs completed automatically. Work resumed the same Codex conversation
   (`01a108ca-c884-7d01-8ae5-783fefeadf5b`); manual Simple retained
   `01a108ca-6843-7a33-b5cd-596e2cd75b31`. Preparation, finalization and work
   markers remained single lines. F1 history retained thought/action/response
   activities, including fresh context MCP and Bash actions and the final
   `resumed successfully` response. No recovery errors occurred in this pass.
5. Started DEF-2 using Cyrus's original Simple ticket path. Gracefully stopped
   during its shell diagnostic and restarted. `resumeAgentSession` used the
   existing conversation `01a108cb-c7b7-78b3-bd82-9308e9631d4c`. The final response
   was `Legacy Simple resumed successfully.`, status was complete and
   `legacy-once.txt` still contained one `ONCE` line.
6. Started and explicitly terminated a separate script run. After the next
   restart it remained stopped, with zero recovery events. Completed Factory
   and manual Simple runs were also left completed.

Representative commands:

```sh
apps/f1/f1 init-test-repo --path /tmp/bobs-factory-resume-drive
bun run scripts/factory.ts --repo /tmp/bobs-factory-resume-drive \
  --home /tmp/bobs-factory-resume-check --port 3473 \
  --agent codex --model gpt-6.1-sol
CYRUS_PORT=3474 apps/f1/f1 create-issue --title 'Restart recovery fixture' \
  --description 'Verify saved questions and interrupted Codex continuation.' \
  --labels workflow:restart-check
CYRUS_PORT=3474 apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3476 apps/f1/f1 view-session --session-id session-1 --limit 5 --offset 17
```

The temporary persisted-tracker driver was
`/tmp/bobs-factory-ui-check/persistent-worker.mjs`. It wraps the same EdgeWorker
with a seeded/restored CLIIssueTrackerService and saves its state on tracker
mutations. It introduces no product code or dependency changes.

## UI verification

T3 preview initially attached, then opening an isolated tab timed out and status
reported no automation host. The native browser connection also timed out. An
isolated Playwright test launched headless Brave with a fresh temporary profile;
no existing user browser/session was controlled. A page-local route fixture
held the answer request while the real static UI rendered and polled.

Passed assertions:

- `Sending answers…`, a spinner and `aria-busy=true` appear immediately.
- The submit button is disabled and a second submit produces no request.
- The answer form and `Blue` text survive polling while pending.
- A simulated 409 displays the error, re-enables submission and retains text.
- Retrying successfully removes the old answer form and announces acceptance.

Screenshots were inspected at `/tmp/bobs-factory-ui-check/sending.png` and
`accepted.png`; the temporary test is `ui-check.mjs` in that directory. No
production input was submitted.

## Automated checks and limitations

- Full final edge-worker suite: **901 passed / 1 skipped**, 84 files.
  Relevant six-file follow-up: **74 passed**. Final queued-init/user-stop
  guard: four files / **28 passed**.
- Durable regression cases cover legacy checkpoint upgrades, nested review
  loops and visit limits, partial fanout, unanswered waits without duplicate
  posting, accepted-answer crash windows and terminal-run exclusion.
- Edge-worker build/typecheck, JS syntax and targeted Biome checks passed.
  Full workspace build/typecheck remain required commit hooks.
- The first stock F1 tracker loses external session data when its process exits;
  subsequent activity posting logged caught `session not found` errors even
  though workflow recovery completed. The persisted-tracker pass removes that
  harness limitation and verifies coherent activity across restarts. Its first
  serialization pass also needed Date revival before F1 pagination could read
  restored activities; the corrected pass succeeded.
- Real provider continuation was exercised with Codex. Other providers use
  their existing `resumeSessionId` support, with graph behavior covered by
  provider-independent tests; live continuation on each was not repeated.
- Incomplete script/direct tool calls may repeat external effects. Recovery
  preserves completed receipts and asks agents to inspect existing work; it
  does not promise exactly-once execution across an external effect/save gap.
- Recovery uses existing repositories/worktrees and local provider transcripts;
  it does not migrate runs to another machine.

Only isolated workers were shut down for cleanup. The production process keeps
its current loaded backend until a later restart; the new static UI is served
without stopping it.

## Idle production rollout

After all validation and the implementation commit, the user's Takeover ended
independently at `pipeline/draft-pr`: the repository's Git hook failed. Its
history/worktree were retained and the failed run was not retried. The process
reported `/status: idle` with no running or waiting factory runs, so a private
state backup was saved and the service was restarted to load the new backend.
No active agent was interrupted by this rollout.

Production PID changed from 22338 to 88119. The new backend served the feedback
UI and automatically continued the two legacy ticket sessions persisted as
active. The failed Takeover remained failed at the same step. The runtime source
pin was updated without changing Git/SSH/signing settings or the webhook tunnel.
