# Grouped repositories across workflows

Date: 2026-10-08. Branch: `feat/shared-workflow-repository-scope`.

F1 applies because this change affects routing, worktrees, workflow execution,
delivery and recovery. The drive uses an embedded EdgeWorker, the CLI issue
tracker, three isolated Git repositories with local bare remotes, authenticated
Factory HTTP requests, and deterministic mocked agents/provider responses.
Production configuration, remote repositories and provider credits are untouched.

Run from the repository root:

```sh
F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/grouped-workflows.ts
```

The drive passed these assertions:

- A shared label routes an assignment to all three repositories and Factory
  retains their individual worktrees and base branches.
- Identical label sets expose one `niotix` composer project. Manual, Simple,
  Takeover and custom/nested launches retain the same complete scope.
- Scripted implementation changes two repos; built-in publication creates two
  draft PRs and leaves the third repo as context. Git commits/pushes are real.
- A mocked requirement extractor and all six stock specialist reviewers receive
  every repository and share frozen per-repository heads and bases. CI/handoff inspect
  both delivered revisions. The human gate contains both exact URLs/heads;
  client-supplied repository metadata cannot replace the server-owned approval.
- Both merges must be confirmed before the workflow completes. Issue-session
  and Factory activities remain visible, and shutdown completes cleanly.

Focused regression tests additionally protect partial publication/merge retries,
stale approval in any repository, repositories first changed by a fixer, updated
delivery heads after corrections, read-only merge recovery after cleanup,
repository-specific credential bindings, and immutable review files with
identical filenames in different repositories. Existing single-repository,
workflow, incremental, routing and prompt tests pass.

Monorepo type checking, the CLI dependency build and lint pass. Lint reports 19
existing warnings. The unrelated private OpenPGP execution test cannot run on
this Mac because `gpgconf` is absent; the other 23 ExecutionProfiles tests pass.

Raw local receipts are in `node_modules/.cache/f1-grouped-workflows.json` and
`node_modules/.cache/f1-grouped-workflows.log`. This establishes orchestration and
revision safeguards with simulated provider responses, not live forge behavior,
model reasoning, visual QA or native agent execution. The Takeover scenario
checks scope admission and worktree inheritance; existing-PR branch handling
retains its focused provider tests.

After integrating `main` at `ec185ab3` (specialist review), the drive was updated
and rerun successfully with the stock extraction/fanout contracts. Regression
tests verify clean three-repository review, repository-specific aggregate
provenance, and refusal to accept a review after a secondary repository receives
uncommitted edits or a new commit. The full-prompt routing assertion retains both
grouping and specialist capabilities. The other 218 affected checks pass; the
initial missing prompt text was corrected and its five tests pass.
