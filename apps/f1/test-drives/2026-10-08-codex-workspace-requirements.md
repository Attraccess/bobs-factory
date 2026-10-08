# Codex workspace-requirements reload recovery

**Date:** 2026-10-08  
**Candidate:** `t3/fix-recurring-run-failure`, based on `236afd2a`, with the permission-profile launch fix.

## Root cause and native reproduction

Run `463ee480-491a-4577-8f5d-f66bb4210a61` repeatedly failed in
`pipeline/implement` with `failed to load workspace requirements`, zero usage,
and the established Codex conversation still checkpointed. Its frozen workflow
selects Codex for this role even though the run-level default is OpenCode; that
selection is intentional.

Codex 0.160.1's account-routing configuration rebuild retains the selected
profile in session flags but replaces the CLI configuration layer. Bob's Factory
previously defined its generated Git-metadata profile only in the thread
request. The rebuilt configuration selected an undefined profile and failed
before reaching inference. Repeating the same request or clearing the established
conversation does not repair the configuration.

The fix defines the same profile in the app-server launch's CLI configuration,
with an explicit default selection required by native profile configuration.
Thread settings continue to use the same definition. Canonical launch arguments
also separate pooled processes with different filesystem/network permissions.
Native credentials, sandbox restrictions, workflow checkpoints and IDs remain
in place.

An isolated native reproduction used the prepared `codex-cli 0.160.1`, temporary
Codex homes, fabricated ChatGPT-format credentials and a local HTTP/SSE fixture.
`openai_base_url` and `chatgpt_base_url` both pointed to that fixture. No real
credentials, model inference or provider credits were used.

```sh
python3 -u /tmp/bobs-codex-profile-native.py
```

Evidence:
`/var/folders/_r/fld8l71j7ts635hlb5vtgnb80000gn/T/bobs-codex-profile-exsr0_l8`.
Without launch registration, the turn reproduced the exact requirements error
and never requested a response. With registration, the native turn reached the
local fixture and completed with `fixture complete`. The native client first
attempted WebSockets and then used the fixture's HTTP/SSE transport. Both RPC
logs are retained under the isolated `before` and `fixed` homes.

## F1 applicability and drive

F1 applies because this changes runner startup, native configuration reload and
session continuation. The embedded CLI-platform EdgeWorker used a fresh Git
repository, real linked worktrees, isolated Factory home, one-slot capacity pool,
issue-tracker RPC on 3600 and the protected Factory API on 3618.

Codex was replaced by a scripted JSON-RPC peer. It parsed the actual CLI
overrides as TOML, required its selected profile to match the thread definition,
and emitted tool lifecycle events and structured role results. Other providers
and title jobs used `MockAgentRunner`. A synthetic session existed only in the
temporary Factory authentication store; normal API authentication and mutation
header checks remained active. The in-memory external issue tracker and activity
sink were retained across worker replacement.

```sh
F1_AGENT_MODE=mock bun node_modules/.cache/f1-codex-profile.ts
```

The driver and scripted peer are retained in `node_modules/.cache/` as
`f1-codex-profile.ts` and `f1-codex-profile-peer.py`, with its execution log in
`f1-codex-profile.log`. Final evidence is at
`/private/var/folders/_r/fld8l71j7ts635hlb5vtgnb80000gn/T/bobs-codex-profile-f1-dsY0lj`,
containing the persisted run, native request/launch receipts and `receipt.json`.

Assertions passed:

- Issue creation and assignment through the real F1 RPC selected the custom
  workflow and created an isolated linked worktree.
- The nested implementation role received writable shared Git metadata while
  `.agents` remained read-only and broad reads retained the accepted policy.
- The scripted account reload found the profile at process launch and matched
  the thread definition.
- The first role result waited for explicit assistance; restarting the worker
  retained its questions, history and exact native session ID.
- An answer through the protected API resumed that same native session and
  completed, retaining both role receipts and the submitted answer.
- Tool and final-response activities were visible; the final capacity pool had
  zero active and queued leases, and shutdown freed both listeners.

Initial exploratory attempts corrected fixture setup: required stock workflow
definitions, loopback origin configuration, and polling before asynchronous run
creation. They were stopped cleanly. Final evidence comes from the passing drive.

## Other verification and limits

- Codex runner: 120 tests passed, including profile-launch quoting and pool
  isolation when filesystem grants change.
- Relevant EdgeWorker workflow, Codex configuration/activity and capacity suites:
  134 tests passed.
- Dependency build through EdgeWorker, workspace typecheck, lint and
  `git diff --check` passed. Lint retained 19 existing warnings.

This establishes native configuration behavior with fabricated credentials and
scripted Factory orchestration. It does not claim successful live inference or
completion of NG-845. The production run was not reset, answered, or retried by
this drive; applying the updated service allows its existing checkpoint to retry.
