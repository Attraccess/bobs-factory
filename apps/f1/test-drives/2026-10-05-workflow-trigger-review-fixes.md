# Workflow trigger review fixes

Date: 2026-10-05. Taskbot bobs-factory #35 / pilot #56, draft PR #2.
Tested revision: `30837ca89f9c952ac554e378512ab2a29126da04` plus the review
fixes. `fix-35-tested-revision.json` in the run evidence directory records the
SHA-256 of the tested code/test diff.

## Changed behavior and isolation

The drive covers the scalar `agentSession.commentId` fallback and its persisted
origin after restart. Chromium separately repeats the Recipes save race with
an eight-second configuration refresh delay. All fixture code, state and
worktrees are under this worktree's `node_modules/.cache/fix35/`. The deployed
service and its configuration were untouched. F1 used ports 3610/3611; the
browser reproduction used 3612.

## Commands and assertions

```sh
apps/f1/f1 init-test-repo --path "$PWD/node_modules/.cache/fix35/repo"
bun run node_modules/.cache/fix35/setup.mjs
bun run node_modules/.cache/fix35/fixture.mjs
CYRUS_PORT=3611 apps/f1/f1 ping
CYRUS_PORT=3611 apps/f1/f1 create-issue \
  --title 'Scalar source comment ID regression' \
  --description 'Persist the available comment ID from a created session without the optional comment object.'
CYRUS_PORT=3611 apps/f1/f1 create-comment \
  --issue-id issue-1 --body '@Bob preserve this scalar comment ID'
curl --fail -H 'Content-Type: application/json' \
  --data '{"commentId":"comment-1"}' \
  http://127.0.0.1:3611/fixture/comment-session
CYRUS_PORT=3611 apps/f1/f1 view-session --session-id session-1 --limit 20 --offset 0
CYRUS_PORT=3611 apps/f1/f1 stop-session --session-id session-1
```

- `session-1` / `DEF-1` completed the script-only `origin-probe` workflow.
  The root receipt retained `comment-1`, issue/session IDs, source timestamp
  and the saved-default selection method. F1 showed acknowledgment and routing
  activities; no agent or external delivery was invoked.
- After stopping and restarting only the fixture service, the dashboard API
  returned exactly the same `triggerOrigin`, including `comment-1`.
- Chromium on the actual built FactoryServer/WorkflowRuntime showed disabled
  permission controls while configuration refresh was pending. After refresh,
  revoking the next permission saved `[]`, preserving the revoked manual
  permission. Reload retained both unchecked controls.
- Revoking the referenced shared pipeline's call permission returned HTTP 409,
  displayed the existing actionable error, and retained the saved checkbox.
- The existing serialization regression now exercises both optional comment
  objects and scalar-only IDs, including delayed replies and session restore.
  The optional comment object's ID still takes precedence over the scalar.

## Evidence and limits

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-761b34f4-b10c-4e91-901c-95a3d64c2dff/`.
It contains the fixture scripts, origin receipts before/after restart,
`fix-35-permission-server.log`, and inspected screenshots
`fix-35-permission-refresh-pending.png` and `fix-35-permissions-saved.png`.

This is local CLI transport validation, not real Linear validation (#55).
The disposable bridge calls the existing comment-session API because the F1
comment RPC ignores `mentionAgent`. Its transport fixture converts the comment
object to the scalar-only webhook shape from the finding. Production capture
code is exercised without patching it. Scalar IDs alone do not prove a mention;
the existing CLI subtype behavior remains unchanged. The fixture persists its
in-memory tracker state separately for restart comparison.

Checks passed: edge-worker suite (979 passed, one existing skip), `pnpm build`,
`pnpm typecheck`, changed-file Biome, and `git diff --check`. Browser page errors
were empty. Only fixture processes were stopped; historical evidence remains
unchanged. No human approval, merge, or deployment occurred.
