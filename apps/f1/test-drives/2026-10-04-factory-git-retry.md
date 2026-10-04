# Factory Git publication and failed-step retry

Date: 2026-10-04. Tested `3246896` plus the Taskbot #17 working changes.

The reported ATT-1127 failure was a commit-message rejection: publication used
the raw ticket title, and Attraccess's `commit-msg` hook requires a conventional
commit. Earlier cached lint warnings were not the failing hook.

## Scenario and assertions

Use a CLI issue and a two-step workflow: write an implementation marker, then
run the real `draft-pr` tool. Deliberately reject the first commit through a
temporary Git hook. Allow the next attempt, retry through the dashboard, and
verify the original preparation does not repeat and publication succeeds with
a conventional commit. Keep real Git hooks enabled throughout.

## Execution

- Fresh repository `/tmp/factory-git-retry-drive`, bare remote
  `/tmp/factory-git-retry-remote.git`, worker home
  `/tmp/factory-git-retry-fixture`, UI 3481 / CLI RPC 3482.
- Used the persisted CLI tracker/EdgeWorker driver from the restart drive,
  with a fresh tracker and configuration. A fixture `gh` executable returns an
  existing draft PR URL; Git commits and pushes use the real local remote.
- `CYRUS_PORT=3482 apps/f1/f1 create-issue --title 'Power Consumption Billing'
  --description 'Exercise preserved-step Git retry' --labels 'workflow:git-retry'`
  created DEF-1 / issue-1.
- `CYRUS_PORT=3482 apps/f1/f1 start-session --issue-id issue-1` created session-1.
  The prepare receipt persisted, then publication failed with the deliberate
  `temporary hook failure` message. The issue session's routing activities were
  visible through `view-session`.
- T3 preview inspected the failed run and its **Retry failed step** button.
  After allowing commits in the fixture hook, clicked that button. The UI showed
  `Retry accepted. Continuing from saved progress.` and then completed status.
- The hook required exactly `chore: power consumption billing`. The resulting
  commit matched, the branch was pushed, and the remote contained `code.txt`.
- The same session-1 completed with exactly `prepare`, `publish` receipts and
  exactly one line in `implementation-count`. A further retry returned 409.

An initial completion assertion raced the asynchronous push/PR lookup; waiting
for the dashboard's completed status established the final passing assertions.
The fixture was stopped after validation.

## Other checks and limits

Focused runtime/pipeline/API tests cover both current checkpoints and legacy
receipt reconstruction, retained history, duplicate/terminal/explicit-stop
rejection, protected API access, and ticket-title commit formatting. Build,
type checking, JS syntax and targeted Biome checks passed. Required repository
commit hooks also run the full workspace build/type checks.

This drive does not claim live GitHub CI or a completed review pipeline. The
actual ATT-1127 publication/resumption is recorded separately in Taskbot #17.
