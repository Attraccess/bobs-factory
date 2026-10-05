# Workflow launch permissions and origin receipts

Date: 2026-10-05.
Taskbot: bobs-factory #35, self-improvement pilot #56.
Tested HEAD: `f70c6cb0f20a7abe3d75349efa62e534d9695e5b` plus the uncommitted
implementation. The evidence directory contains `implementation-35-tested-revision.json`
with a SHA-256 of the code/test diff before this report was added.

## Scenario and isolation

F1 applies because this change controls ticket-session selection, rejection,
session recovery, and activity output. The assertions cover selecting one recipe
before checking its launch permission, preserving accepted definitions and
receipts across restart, and separating root launch origins from nested calls.

The fresh repository, dependencies, factory configuration, worktrees, and state
were contained in this factory worktree under `node_modules/.cache/manual35/`.
The installed Bob service, `/Users/jappy/code/jappyjan/bobs-factory`, and its
configuration were not changed. UI port 3610 and F1 RPC port 3611 were used.

Initial setup:

```sh
pnpm install --frozen-lockfile
pnpm build
apps/f1/f1 init-test-repo --path "$PWD/node_modules/.cache/manual35/repo"
bun run node_modules/.cache/manual35/setup.mjs
bun run scripts/factory.ts \
  --repo "$PWD/node_modules/.cache/manual35/repo" \
  --home "$PWD/node_modules/.cache/manual35/home" --port 3610
CYRUS_PORT=3611 apps/f1/f1 ping
CYRUS_PORT=3611 apps/f1/f1 status
```

The fixture retained stock recipes and added deterministic scripts:

| ID | Permissions | Label / behavior |
| --- | --- | --- |
| `probe` (saved default) | workflow, manual, ticket-assignment | `workflow:probe`; script receipt followed by `shared-probe` |
| `shared-probe` (internal) | workflow | Script receipt, without an agent |
| `alternate` | workflow, manual, ticket-assignment | `workflow:alternate`; script receipt |
| `denied` | manual | `workflow:denied`; placed before `alternate` for the rejection case |
| `restart-probe` | manual, ticket-assignment | `workflow:restart`; script waits for a fixture-local release file |
| `wait-root` | manual, ticket-assignment | `workflow:wait`; calls `wait-shared` |
| `wait-shared` (internal) | workflow | Deterministic human-review wait |

For restart, mention, and human-wait checks, a disposable bootstrap
`node_modules/.cache/manual35/fixture.mjs` used the real built `EdgeWorker` and
`CLIIssueTrackerService`, the same isolated home/repository/ports, and persisted
only the fixture tracker's in-memory state with `node:v8` on graceful shutdown.
It added a loopback `/fixture/mention` bridge to the existing
`createAgentSessionOnComment` API because the F1 create-comment RPC ignores
`mentionAgent`. Its human-review tool hook returned a fixture receipt instead
of creating a PR. Production source and the F1 harness were not patched for
these accommodations. Copies of both bootstrap scripts are in the evidence
directory for inspection.

## Results

| Scenario | Receipt | Assertions and outcome |
| --- | --- | --- |
| Unlabeled eligible default | session-102 / DEF-102 | Completed `probe`; selection method `default`; CLI assignment subtype and source IDs persisted; exactly one durable nested call to `shared-probe`. |
| Eligible workflow label | session-103 / DEF-103 | Completed `alternate`; selection method `label`, with assignment origin. |
| Disallowed first configured matching label | session-104 / DEF-104 | Labels `workflow:denied,workflow:alternate`; readable `response` rejected `denied`; no run or worktree. Did not fall through to the eligible alternate. |
| Ineligible saved default | session-105 / DEF-105 | Saved `denied` as default; unlabeled start visibly rejected it; no run or worktree despite other eligible recipes. |
| Comment mention | session-100 / DEF-100 | Actual comment-session event selected `alternate`; persisted CLI mention subtype, source comment ID, timestamp, issue and session IDs. |
| Script interruption | session-6 / DEF-6 | Stopped fixture process during the script, restarted, released its wait; completed with unchanged root origin. |
| Accepted nested human wait across restart | session-101 / DEF-101 | Reached `waiting`; disabled live root and child permissions and replaced the live root steps; restart preserved the exact frozen definitions, origin, checkpoint and single call receipt. No human approval was issued. |
| Internal manual permission | manual-cbaf4838-5bff-4f51-8244-7875a1d86d1b | Browser enabled manual access on `shared-probe`; save survived reload and JSON editor agreed; Composer offered it and started its script with empty launch fields. Completed with explicit manual `composer-api` origin. |
| Follow-up permission and provenance | manual-3b0f98fb-1dda-4787-a5e3-e3e4d42a9be8 | Disabled the explicit Factory target: HTTP 409 and unchanged run count. Enabled it with a fixture script: completed with manual `follow-up` origin and the exact source-run ID. |

Representative final-build commands:

```sh
CYRUS_PORT=3611 apps/f1/f1 create-issue \
  --title 'Final default selection receipt' \
  --description 'Unlabeled ticket uses saved eligible recipe'
CYRUS_PORT=3611 apps/f1/f1 start-session --issue-id issue-102
CYRUS_PORT=3611 apps/f1/f1 create-issue \
  --title 'Final alternate selection receipt' \
  --description 'Eligible label selects alternate' --labels workflow:alternate
CYRUS_PORT=3611 apps/f1/f1 start-session --issue-id issue-103
CYRUS_PORT=3611 apps/f1/f1 create-issue \
  --title 'Final first label rejection' \
  --description 'Disallowed first configured label cannot fall through' \
  --labels workflow:denied,workflow:alternate
CYRUS_PORT=3611 apps/f1/f1 start-session --issue-id issue-104
CYRUS_PORT=3611 apps/f1/f1 view-session --session-id session-104 --limit 10 --offset 0
CYRUS_PORT=3611 apps/f1/f1 view-session --session-id session-105 --limit 10 --offset 0
CYRUS_PORT=3611 apps/f1/f1 stop-session --session-id session-101
CYRUS_PORT=3611 apps/f1/f1 stop-session --session-id session-104
CYRUS_PORT=3611 apps/f1/f1 stop-session --session-id session-105
```

Factory config mutations used `/api/workflows` with `X-Factory-Request: 1`;
run/detail assertions used `/api/runs`. The run with the accepted human gate
was confirmed `stopped` after cleanup. The fixture processes and named browser
session were shut down, and neither fixture port retained a listener.

## Browser and automated checks

Chromium, driven through `agent-browser --session manual35`, confirmed:

- Accessible, independent permission checkboxes; Simple's workflow-call option
  is disabled. Revoking a referenced shared recipe's call permission displays
  an inline error and retains the saved checkbox state.
- A disabled selected/default recipe leaves no substitute selected, disables
  Start, and shows a Recipes link. Existing text survives the permission update;
  arrow-key selection of an eligible recipe restores it.
- With every manual permission removed, no radio options remain and Start is
  disabled. The empty-state message and controls fit a 390px viewport without
  horizontal page overflow. Longer desktop recipe lists wrap cleanly.
- The run detail displays the root assignment receipt, source link, caller
  workflow/step, nested target and timestamp. Root and nested receipts remain
  separate. No browser page errors were reported.

Screenshots were opened and visually inspected. Evidence is under
`/Users/jappy/.cyrus/factory/evidence/manual-761b34f4-b10c-4e91-901c-95a3d64c2dff/`:

- `implementation-35-recipes.png`
- `implementation-35-origin.png`
- `implementation-35-ineligible-default.png`
- `implementation-35-empty-composer.png`
- `implementation-35-final-f1-receipts.json`
- `implementation-35-f1-receipts.json`
- `implementation-35-manual-receipt.json`
- `implementation-35-followup-receipt.json`

Additional checks passed: full `pnpm build` and `pnpm typecheck`; edge-worker
Vitest suite (89 files, 978 passed, one existing skipped); core suite (13 files,
198 passed); Biome on changed TypeScript/TSX/CSS (13 warnings in existing CSS
rules); `git diff --check`. Targeted regressions cover legacy normalization,
atomic invalid edits, explicit/label/default rejection, frozen runtime checks,
original Simple session persistence, delayed origins, missing-session startup,
spoofed API provenance, backend follow-ups, and stock Factory/Takeover composition.

## Limits

This is local CLI issue-tracker coverage, not a real Linear or Taskbot transport
test. The F1 comment RPC needs the fixture bridge described above. Original
Simple runner lifecycle, delayed repository selection, and full stock pipeline
composition were checked with targeted tests rather than live agents. No agent,
external PR, merge, or deployed-service change was part of this drive. The human
wait used a deterministic tool receipt; it validates recovery without exercising
a real GitHub review or granting approval.

The fresh repository has no origin, so expected fetch warnings used local
`main`. The initial standard CLI tracker was in-memory; its activities did not
survive the first process restart. Later restart checks persisted only fixture
tracker state. Earlier recorded origins without a known subtype were preserved
as unknown rather than backfilled; the final-build assignment/mention checks
used new sessions with available source evidence. Historical F1 reports remain
unchanged.
