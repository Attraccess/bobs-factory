# Guided installation, protected onboarding and native GitHub delivery

**Date:** 2026-10-08 21:06 UTC

**Result:** PASS — mocked agents and controlled GitHub transport

**Goal:** A new operator can enroll a passkey, choose an existing project and
coding agent, restart with that setup preserved, and deliver through the native
GitHub provider without executing `gh`.

## Applicability and tested source

The runtime changes affect authentication, first-launch repository selection,
credential ownership and issue-driven delivery, so relevant F1 validation is
required. Installer/release tooling, Nix and marketing-page changes use their
separate script/install/evaluation/browser checks.

Tested base commit: `61b0a608eef140149272d34b299a7b61a3a59999`, with uncommitted
implementation changes. This is **not** a clean release-candidate result.

The fixture fingerprints the sorted paths listed below as
`SHA256(concat(path + NUL + SHA256(file bytes) + newline))`, checks the value
before and after execution, and fails if runtime source changes during the drive:

```text
9240c025e2db531e9bdd404005dd594b6838dbb2d4f76df98b2d2d3ae6fd6ec2
```

- `apps/cli/src/app.ts`
- `apps/cli/src/cli.ts`
- `apps/cli/src/github.ts`
- `apps/cli/src/local.ts`
- `apps/cli/src/onboarding.ts`
- `packages/codex-runner/src/config/CodexConfigBuilder.ts`
- `packages/core/src/agent-runner-types.ts`
- `packages/cursor-runner/src/CursorRunner.ts`
- `packages/cursor-runner/src/CursorWorkerRunner.ts`
- `packages/cursor-runner/src/cursor-worker.ts`
- `packages/edge-worker/src/ChatRepositoryProvider.ts`
- `packages/edge-worker/src/ChatSessionHandler.ts`
- `packages/edge-worker/src/EdgeWorker.ts`
- `packages/edge-worker/src/GitService.ts`
- `packages/edge-worker/src/RunnerConfigBuilder.ts`
- `packages/edge-worker/src/factory/ExecutionEnvironment.ts`
- `packages/edge-worker/src/factory/FactoryOnboarding.ts`
- `packages/edge-worker/src/factory/FactoryServer.ts`
- `packages/edge-worker/src/factory/FactoryTools.ts`
- `packages/edge-worker/src/factory/GitProvider.ts`
- `packages/edge-worker/src/factory/GithubApi.ts`
- `packages/edge-worker/src/factory/GithubProvider.ts`
- `packages/edge-worker/src/factory/GithubReadiness.ts`
- `packages/edge-worker/src/factory/GithubTakeover.ts`
- `packages/edge-worker/src/factory/Takeover.ts`
- `packages/edge-worker/src/factory/Workflow.ts`
- `packages/edge-worker/src/factory/WorkflowRuntime.ts`
- `packages/edge-worker/src/factory/defaultWorkflows.ts`
- `packages/gemini-runner/src/GeminiRunner.ts`
- `packages/opencode-runner/src/OpenCodeRunner.ts`

## Execution

Run from the repository root:

```sh
F1_AGENT_MODE=mock F1_ONBOARDING_PORT=3650 bun run apps/f1/test-drives/assets/simple-install-onboarding.ts
pnpm exec biome check apps/f1/test-drives/assets/simple-install-onboarding.ts
```

Both commands passed. The first uses a fresh isolated factory home/project/local
bare Git origin, dashboard port 3650 and F1 RPC port 3651 for this recorded run.
The default ports are 3600/3601. `F1_ONBOARDING_PORT` can select another available
port. It preserves the real user home and isolates
the migration-source capacity directory. The successful fixture stops both
workers and removes its temporary state; failed attempts retain their private
state for diagnosis. No production worker, Git configuration, credentials or
repository was changed.

## Assertions and results

### Protected first launch

- Real `EdgeWorker` and CLI `LocalOnboarding` start with no project selected.
- GET/POST onboarding endpoints return 401 without a session.
- Registration uses the real WebAuthn server verifier, CBOR attestation and EC
  signatures from the existing software authenticator fixture. No authentication
  state bypass or verifier mock is used.
- Invalid project selection returns 409 and preserves the empty configuration.
- A forged request origin returns 403 without applying setup.
- Authenticated selection saves the real Git project and `codex` selection.
  Unknown operator-owned configuration fields survive.
- GitHub setup reads account/repository permissions and actual GraphQL PR/CI
  readiness fields before saving. A controlled permissions failure returns 409
  and leaves credentials absent; a valid response saves the synthetic token with
  mode 0600 and returns account/status without returning the token.

### Restart and issue processing

- Restart preserves the selected project/agent, credential account, passkey state
  and existing authenticated browser session.
- A real F1 RPC issue and session select the saved repository and create its own
  real worktree.
- `f1AgentHandlers("mock", ...)` intercepts all agents, including background title
  work. The scripted implementation changes one fixture file and commits/pushes
  it to the local bare origin.
- The native GitHub provider creates an open draft through REST and reads
  readiness through GraphQL. The originating issue/activity path and protected
  dashboard activity API remain readable.
- Activity payloads have timestamps, types and readable contents. Pagination at
  limit 1/offset 1 returns the exact second visible activity and preserves the
  total count.

### Native delivery and revision ownership

- The connected private account wins over a different synthetic ambient token;
  every controlled provider request asserts the chosen credential and refuses
  redirect following.
- Missing explicit merge SHA is rejected before transport.
- A stale human-approval SHA returns a fix receipt and sends no merge request.
- Approval of the current real worktree SHA transitions the draft through the
  native GraphQL mutation, sends that exact SHA in the REST merge request, and
  waits for the controlled provider's confirmed merged state.
- No saved token appears in run/timeline receipts or provider log output.
- Failing `gh` and `codex` sentinels on fixture PATH are never invoked.
- The session stops cleanly and both EdgeWorkers shut down.

Key output:

```text
PASS real passkey registration; signed-out and forged-origin setup denied; project/agent saved privately; GitHub token not returned
PASS restart preserved selected project/agent, credentials, passkey and authenticated session
PASS F1 issue → selected repository/worktree → mocked agent activities → real local Git commit/push → native REST draft + GraphQL readiness
PASS stale approved SHA refused; current approved SHA → native draft transition → exact-SHA merge confirmation; zero gh/native-agent execution
agentMode: mock
liveProviderRequests: 0
ghExecutions: 0
nativeAgentExecutions: 0
nativeGitHubRequests: 27 (controlled transport)
```

## Native adapter verification

Separate adapter checks validate the environment boundary without live inference.
All package suites passed: Codex 131, Gemini 200 (one existing skipped test),
OpenCode 34 and Cursor 53. All four package typechecks passed. The amended Codex
isolated-environment assertion was rerun afterwards and its three focused tests
passed. The installer/publication suite passed all nine regression tests after
integration, including rejection of private/internal release repositories.

The regressions verify that native Git/helper additions reach Codex’s app-server
launch configuration and Gemini’s spawn environment. Real OpenCode and Cursor
worker children receive the scoped helper/token mapping. Native HOME and existing
CODEX_HOME/XDG roots remain intact, while complete isolated environments exclude
ambient credentials. Cursor’s installed SDK 1.0.19 has no local environment option;
the existing dedicated IPC worker supplies its environment without changing the
shared host process. Its existing mock mode avoids SDK provider calls.

## Supplemental browser evidence

The parent task separately ran the source-built dashboard in a browser using a
virtual WebAuthn authenticator. Passkey registration, project selection and
persistence passed. GitHub connection was deferred in that browser flow; the
synthetic token/account transport is exercised by the drive above. These captures
show actual source-built UI, not a published release:

- Homepage: [desktop](media/2026-10-08-simple-install-onboarding/homepage-desktop.png),
  [mobile](media/2026-10-08-simple-install-onboarding/homepage-mobile.png).
- Project and installed-agent selection:
  [desktop](media/2026-10-08-simple-install-onboarding/onboarding-project-desktop.png),
  [mobile](media/2026-10-08-simple-install-onboarding/onboarding-project-mobile.png).
- Optional connection:
  [GitHub step](media/2026-10-08-simple-install-onboarding/onboarding-github-desktop.png).
- Completed setup:
  [ready state](media/2026-10-08-simple-install-onboarding/onboarding-ready-desktop.png).

## Limits

The provider HTTP boundary is scripted: no live GitHub repository, PR, token or
merge is created. The approval receipts used for the focused merge guard are
explicit fixture inputs; this drive does not claim a full human review-guide
browser workflow. Git operations use a real local bare origin. GitHub SSH-to-
HTTPS credential-helper behavior has its separate focused regression checks.
This drive exercises ordinary exact-SHA merges; merge-queue semantics use the
separate provider regression tests.

Agents are deterministic mocks. This does not validate a live coding-agent login,
model/tool behavior, provider credits or physical passkey hardware. Source imports
warn that compiled bundled skills are unavailable; final binary/resource checks
are separate. The drive does not validate all native platforms, complete migration
preservation, or the whole payload for a public release. No release was published,
tag moved, PR merged or production service restarted.
