# Factory Git provider publication and recovery

**Date:** 2026-10-08
**PR:** [#46](https://github.com/Attraccess/bobs-factory/pull/46)
**Candidate:** `fix/provider-neutral-factory`, based on
`eebe4d14897a2654784b16847ca8a64e11f2d129`, with the provider-interface working diff.
**Goal:** Validate GitLab and custom-adapter Factory delivery without GitHub CLI,
including retained implementation on retry and merge recovery without a worktree.

## Applicability and setup

Publication, CI readiness, repository routing and recovery are runtime behaviors
covered by F1, so a relevant drive was required. An embedded EdgeWorker used
`f1AgentHandlers("mock")`, fresh repositories, a local bare Git remote, isolated
Factory home and scripted provider executables. Git worktree creation, commits,
pushes, HTTP run endpoints, issue-tracker RPC and persisted workflow recovery were
real. Provider API responses and agents were simulated.

The Factory HTTP listener used port 3611 and the F1 issue-tracker listener 3612.
A synthetic credential/session was installed only in the temporary authentication
store; requests still passed the normal cookie, origin and request-header checks.
The fixture's `gh` executable failed immediately if invoked. Its fake `glab` and
custom adapter recorded every command and working directory.

## Assertions and results

| Scenario | Assertions | Result |
| --- | --- | --- |
| GitLab manual delivery | Real isolated worktree, commit and push; explicit GitLab host and subgroup project; open draft MR; readiness at the published SHA; visible publication activities | Passed |
| Provider failure and retry | First list call failed after push; retry retained the accepted provider, one implementation execution and its history, then published successfully | Passed |
| Custom forge | Direct executable received the protected JSON request-file protocol; creation was verified by `view`; normalized CI permitted review while retaining the draft/human gate; no `gh` | Passed |
| F1 ticket assignment | RPC created an issue and returned its identity; description selectors routed the assignment to GitLab and the chosen workflow; ticket reference survived publication; issue-session and Factory activities were present | Passed |
| Merge recovery | Saved human approval bound to the merged source SHA; worktree deliberately absent; provider receipt recovered the merge, retained guide history and settled the run | Passed |

The HTTP server and sessions started successfully and stopped cleanly. No
unhandled errors remained in the final drive. The fixture deliberately produced
one handled provider outage. Source-mode startup warned that the temporary home
had no bundled skills plugin; scripted implementation did not require one.

## Commands and receipts

```sh
F1_AGENT_MODE=mock bun node_modules/.cache/f1-provider-drive.ts
pnpm --filter bobs-factory-core test:run
pnpm --filter bobs-factory-config-updater test:run
env -u BOBS_FACTORY_INTERNAL_EXECUTABLE pnpm --filter bobs-factory-edge-worker exec vitest run --exclude test/ExecutionProfiles.test.ts
pnpm --filter bobs-factory-edge-worker exec vitest run test/ExecutionProfiles.test.ts -t '^(?!.*signs and verifies with an explicitly prepared private OpenPGP home)'
pnpm build
pnpm typecheck
pnpm lint
git diff --check
```

Final drive output:

```text
PASS GitLab: real worktree/commit/push, provider retry, implementation retained, current revision CI, visible activities
PASS custom adapter: real worktree/commit/push, JSON file protocol, provider CI, no GitHub CLI
PASS F1 issue tracker: created issue, description routing, assignment workflow, GitLab draft/CI, ticket identity and timeline
PASS GitLab recovery: deleted worktree, approved SHA, retained history, provider-confirmed merge and settled view
```

Local driver, log and command/run receipts are in
`node_modules/.cache/f1-provider-drive.ts`, `f1-provider-drive.log` and
`f1-provider-receipt.json`. The first drive reported `results: passed` and run IDs
`manual-c8b8f74a-be00-4732-82e8-0343b927f0e0`,
`manual-0246c0ff-08d2-4423-84f6-e88b8724577f`, `session-1` and `merge-recovery`.
The temporary fixture root was removed after shutdown.

Worker tests passed 1,521 with one existing skip; execution-profile tests passed
23 with the native OpenPGP test excluded. Core passed 207; config updater passed
52. Build and typecheck passed. Lint retained 19 existing warnings. Regression
tests additionally cover comment pagination, unavailable approvals, revision/CI
mismatches, merge blockers, fork/cross-repository rejection, malformed custom
receipts and merge recovery at a different SHA.

## Integration with current main

Main advanced to `b10a289f` (opt-in Web Push) before publication finished. Both
capability-reference conflicts were resolved by retaining provider guidance and
the incoming notification contract, including the complete prompt assertion.
Incoming EdgeWorker push setup/shutdown hooks remained intact.

On the integrated candidate, frozen installation and `pnpm audit` passed with
no known vulnerabilities. The worker suite passed 1,547 tests with one existing
skip, again excluding the native execution-profile file covered above. The same
F1 drive passed all four scenarios after integration. Additional receipts are
`node_modules/.cache/provider-worker-merge.log`, `f1-provider-drive-merge.log`
and `f1-provider-merge-receipt.json`. Build and typecheck were required again by
the merge commit hook.

## Limits

This drive establishes mocked/scripted orchestration, not live GitLab API,
authentication, models or merge execution. Physical passkey enrollment was not
tested. The native OpenPGP test could not run because `gpg`/`gpgconf` are absent
from the host; the initial full-suite failure is not claimed as passing. Early
driver origin/header, step-name and activity-label mistakes were corrected before
the successful run. No production service, reported run, native credential store
or remote forge was changed.
