# Codex Git metadata permissions

Date: 2026-10-08. Base commit: `b10a289fa378d355bc208893a9027b018115c100`,
with the uncommitted Codex runner fix in this checkout. SHA-256 of the sorted
Codex config sources plus backend `types.ts` and `AppServerCodexBackend.ts`
(path bytes followed by file bytes):
`b9e6b835b17df43564af41cfd9ec1ed834fb863de7e7f8ab747abb03bd8fcb68`.

## Failure and applicability

NG-845 run `463ee480-491a-4577-8f5d-f66bb4210a61` recorded
`FETCH_HEAD: Operation not permitted`. Its native Codex transcript had
`workspace-write`, approvals `never`, and read-only linked/shared Git metadata.
A disposable linked-worktree probe reproduced the exact write denial using
`codex sandbox -P :workspace`; explicit metadata write grants passed.
This runner permission and session lifecycle change requires F1 validation.

## Scenario and results

Executed `F1_AGENT_MODE=mock bun /tmp/factory-git-permission-f1.mjs` with the real
EdgeWorker, CLI issue tracker/RPC on 3600, workflow runtime, Codex configuration
builder, runner event mapper and activity sink. A scripted backend emitted events
for commands executed by native Codex 0.160.1's macOS sandbox. No inference API,
live agent turn, production ticket mutation or external push was used.

- DEF-1 / session-1 used the default filesystem posture; DEF-2 / session-2 used
  restricted reads. Both created isolated worktrees and completed the workflow.
- Native sandbox commands fetched `origin/main`, added a file, committed it and
  pushed to separate branches in a disposable local bare repository.
- Each session exposed Git tool activity and a final response (five activities).
- Writes to worktree/source `.codex` settings and an unrelated home path failed
  with `Operation not permitted` in both cases.
- Restricted reads retained a root deny. The fixture explicitly granted reads
  for its files and the installed Command Line Tools, plus writes to its local
  bare remote because the receiver runs inside the same sandbox.
- Fixture root: `/private/var/folders/_r/fld8l71j7ts635hlb5vtgnb80000gn/T/f1-codex-git-permissions-ExDBZf`.
  The worker stopped cleanly. Production services and persisted runs were unchanged.

## Other validation and limits

- Codex runner build and all 118 tests passed, including metadata discovery for
  linked/sub-worktrees, restricted reads, native read-only/full-access policies,
  and permission serialization on thread start and resume.
- Relevant EdgeWorker configuration, GitService and Codex activity tests: 66 passed.
- Changed-file Biome checks and `git diff --check` passed.
- This validates native filesystem enforcement and scripted orchestration. It
  does not claim a live model turn or recovery of the original production run.
