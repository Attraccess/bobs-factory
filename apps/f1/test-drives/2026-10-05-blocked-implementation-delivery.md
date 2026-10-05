# Blocked implementation and empty PR delivery recovery

Date: 2026-10-05. [PR #8](https://github.com/Attraccess/bobs-factory/pull/8). Tested base: `7b9be55260ea7b09aa04b199276cae43f3c30d7d` plus the fix; code/test/docs diff SHA-256: `d28d1732aa76d9ccc50d18be0ed90588a54a9061e0da82867e2189ae024f07b6`.

## Failure and changed behavior

The reported manual run `manual-edeac3fd-3bc9-4031-8bee-9d2efffcc1fe` failed at `pipeline/draft-pr` with GitHub's “No commits between main and factory/…” error. Its accepted plan retained the source ticket's explicit “backlog only, do not implement yet” restriction. Implementation reported deferral and no changes, but its unvalidated result advanced to publication. The worktree was clean with zero commits ahead of `origin/main`. This is a workflow/runtime defect; retrying GitHub cannot produce implementation changes.

F1 applies to implementation checkpoints, scoped agent context and delivery. The fix requires structured completed/blocked results, waits on implementation questions, supplies human answers alongside the scoped plan, upgrades exact stock instructions for new runs, and rejects blocked or empty deliveries before push. Existing run definitions remain frozen.

## Isolated F1 drive

Fixture scripts, receipts, logs, repository and state are under
`node_modules/.cache/factory-blocker-drive/`. F1 RPC: 3614; Factory API: 3498.
The real compiled EdgeWorker used CLI issue tracking, its activity sink, native
Codex `gpt-6.1-sol` at low effort, and real factory-context MCP. The implementation
prompt/flags were copied from the stock shared pipeline; a script supplied an
accepted backlog-only plan, and a final script asserted exact file content.
No external tickets, PRs or production service were mutated.

```sh
bun run node_modules/.cache/factory-blocker-drive/worker.mjs
CYRUS_PORT=3614 apps/f1/f1 ping
CYRUS_PORT=3614 apps/f1/f1 create-issue --title 'Backlog implementation blocker regression' --description 'Exercise the stock implementation role with an explicit backlog-only accepted plan.' --labels factory
CYRUS_PORT=3614 apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3614 apps/f1/f1 view-session --session-id session-1 --limit 5 --offset 12
```

- DEF-1/session-1 returned `status: blocked` and a concrete implementation question without changing `feature.txt`. Factory status became `waiting / pipeline/implement`; CLI timeline contained the blocked response and clarification question.
- The fixture worker was gracefully stopped and restarted. `waiting-before.json` and `waiting-after.json` retained identical questions, complete history and frozen workflow definitions. No agent reran before an answer.
- A fixture-only POST to `/api/runs/session-1/answer` explicitly authorized changing `feature.txt` to `installed`. The native agent read `/answers` and completed only that change. `completed.json` retained the prior history and definitions and added only the second implementation receipt, verification, and parent workflow receipt. Exact file-content and diff checks passed. The CLI tracker retained 30 activities, including native continuation tool activity.
- DEF-3/session-3 exercised real built-in draft delivery on an unchanged branch against a local bare origin. It failed with the actionable “No implementation changes to publish against main” message, retained zero branch commits, and did not reach push/GitHub. `empty-delivery.json` records this result.
- An earlier DEF-2 fixture accidentally committed generated `.claude/settings.local.json`, then failed because its origin was local rather than GitHub. The corrected fixture ignored generated session configuration (as the real repository does) and reran the empty-branch scenario as DEF-3. This preliminary fixture failure is not passing empty-branch evidence.
- F1 stop-session calls passed for sessions 1 and 3. Only the fixture worker was terminated. No unhandled worker errors occurred; expected delivery failures were persisted normally.

## Verification and limits

`pnpm --filter cyrus-edge-worker test:run`: 1,010 passed, one existing skip.
Changed-file Biome, full monorepo build/typecheck (repository commit hooks) and `git diff --check` passed.
Regression coverage includes a real Git empty branch and empty commit, partial
blocked work, frozen wait/restart/answer recovery, scoped plan/answer input,
stock/custom recipe migration and continuing the same takeover PR.

The drive proves CLI transport/native agent recovery, not real Linear transport
or GitHub publication. Collaborative preview could inspect the reported run,
but failed to load the loopback fixture; no screenshot/UI-interaction claim is
made. API checkpoints and timeline activities were verified. The original
failed run and deployed service remain unchanged. Existing failed runs retain
old definitions and cannot be repaired by retrying PR creation; restart the task
with the updated recipe and an explicit implementation instruction when ready.
