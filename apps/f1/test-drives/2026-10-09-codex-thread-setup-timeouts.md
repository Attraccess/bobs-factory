# Codex thread setup deadlines and Factory Retry

Date: 2026-10-09

Tested source: `89fcc64e` on `fix/codex-resume-timeout`, based on
`1443a7c1caeb33f47fd4cd1fefbd4b0f749cc586` (PR #66).

F1 applies to the changed runner startup and persisted recovery behavior.
Four local failed runs, including the reported manual run, recorded
`thread/resume timed out after 60000ms` with zero inference usage. A copied
rollout reopened successfully in an isolated native probe. The saved
conversation was readable; this evidence does not identify the exact cause of
every intermittent native startup delay.

Thread start/resume now have a bounded 180-second default deadline. Other RPCs
retain 60 seconds, and explicit timeout overrides still apply to both. Setup
timeouts are infrastructure failures, preserving native conversations, rejected
output and correction budgets for Retry.

## F1 scenarios

The existing context-readiness fixture gained an optional timeout mode. It uses
a fresh Git repository and isolated Factory home, the F1 issue/session RPC,
production CodexRunner and app-server backend with a scripted transport, and the
authenticated Factory Retry route fixture. Other roles and background title
generation are mocked. No provider inference is performed.

After building the workspace and F1 CLI:

```sh
F1_AGENT_MODE=mock F1_CONTEXT_FAILURE=thread-timeout \
  bun apps/f1/test-drives/assets/codex-context-readiness.ts
```

| Scenario | Failure assertions | After restart and Retry |
| --- | --- | --- |
| Initial `thread/start` timeout | No model turn or native conversation; infrastructure checkpoint records the exact timeout. | Guide completes; clarify, implementation and CI each ran once. |
| `thread/resume` timeout during output correction | Prior rejected output and native thread remain; reserved correction is refunded to zero attempts. | The same thread resumes and produces a valid guide; completed steps are retained. |

Both issues and linked worktrees were created through F1. Each run retained
three completed history records, cleared its active checkpoint after success,
and emitted timestamped response activities rendered by `f1 view-session`.
Active and queued capacity returned to zero, and worker listeners closed.

```text
F1_CONTEXT_RECOVERY_PASS
readiness:  clarify=1 implement=1 ci=1 guide launches=2 scripted turns=1
correction: clarify=1 implement=1 ci=1 guide launches=3 scripted turns=2
both runs completed; each retained three prior history records
```

Receipts, final runs and rendered activities are retained locally in
`/var/folders/_r/fld8l71j7ts635hlb5vtgnb80000gn/T/f1-codex-context-mFNbIN`.
Console output is `/tmp/bobs-factory-thread-timeout-f1.log`.

## Native setup and regression checks

A separate native Codex 0.162.0 app-server probe copied the reported rollout
into a temporary `CODEX_HOME`. A required stdio MCP fixture delayed its
initialize response by 65 seconds (90-second native startup limit).
The production backend resumed the same thread in 66,267 ms and closed cleanly.
No `turn/start` request was sent; the temporary home was removed. The probe
script and result are `/tmp/bobs-factory-slow-native-resume.mjs` and
`/tmp/bobs-factory-slow-native-resume.log`.

The new regression cases failed against the old implementation and pass with
the fix: real stdio thread setup survives 65 seconds, wedged setup rejects at
180 seconds, and Factory preserves correction state for both thrown and native
result timeouts. Explicit timeout overrides remain covered.

Passed checks:

- Codex runner suite: 17 files, 133 tests; final timeout-override parameterization
  subsequently passed the backend file with 48 tests.
- EdgeWorker capture recovery, Factory attempt outcomes and workflow runtime:
  3 files, 161 tests.
- Codex runner and EdgeWorker builds/typechecks; Biome on changed TypeScript;
  `git diff --check`.
- Required commit hooks: workspace build and typecheck passed.

This validates scripted orchestration and native startup without model work.
It does not validate live model behavior, physical passkey interaction or a
browser Retry. The production service, its failed runs and original native
rollouts were unchanged; rollout and explicit Retry remain pending.
