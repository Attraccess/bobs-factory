# Factory capability reference and planning recovery

Date: 2026-10-05. Failed run: `manual-8321a0ae-7e34-46fc-a622-0acb59021b79`
(Taskbot #55). Tested base: `58b33a4a`; tested code/test/documentation patch
SHA-256: `111181b951accad6eddd8c0e36d5ca76d394f325cb7b41cef3a6930c7b735740`.

## Reproduction and change

Eight native planning reviews rejected the same PLAN-001: the injected sentence
“No workflow message-selector syntax is introduced” was interpreted as forbidding
the requested selector feature. The run exhausted its review budget without a
runtime exception. The shared prompt now identifies existing launch behavior as
a capability reference and evaluates requested product changes against task
requirements, while retaining assigned-role and planning-only restrictions.

## Native F1 validation

Fresh test repository `/tmp/factory-capability-review-repo`, local bare origin
`/tmp/factory-capability-review-origin.git`, worker home
`/tmp/factory-capability-review-home`, CLI RPC 3600 and dashboard 3499.
The disposable bootstrap `/tmp/factory-capability-review-worker.mjs` uses the
actual built EdgeWorker, CLI tracker, LinearActivitySink and native Codex
`gpt-6.1-sol`. No runner output is stubbed. Custom fixture workflows use the stock
plan-review and implementation prompts with bounded fixture-only instructions.

```sh
apps/f1/f1 init-test-repo --path /tmp/factory-capability-review-repo
node /tmp/factory-capability-review-worker.mjs
CYRUS_PORT=3600 apps/f1/f1 ping
CYRUS_PORT=3600 apps/f1/f1 status
CYRUS_PORT=3600 apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3600 apps/f1/f1 start-session --issue-id issue-2
CYRUS_PORT=3600 apps/f1/f1 view-session --session-id session-1 --limit 5 --offset 0
CYRUS_PORT=3600 apps/f1/f1 view-session --session-id session-2 --limit 5 --offset 0
CYRUS_PORT=3600 apps/f1/f1 stop-session --session-id session-2
```

- DEF-1 / session-1 selected `workflow:capability-review`. Its issue contained
  the failed run's exact saved clarification decisions, latest plan and previous
  review. The native reviewer read the paginated fixture completely, closed the
  instruction-conflict objection, and requested removal of the obsolete plan
  prerequisite. Its feedback begins: “PLAN-001’s conflict is superseded by the
  current instructions.” It still required authorization before deferred
  implementation. The fixture completed with valid review JSON; it did not
  silently approve the stale plan.
- DEF-2 / session-2 selected `workflow:restricted-implementation`. Native
  implementation returned `status: blocked` and an actionable question about
  lifting the planning-only restriction. The runtime entered `waiting`, with
  no edits or implementation tests. The F1 stop command then produced `stopped`.
- Both sessions created isolated worktrees and visible tracker activities.
  Structured native outputs and paged tracker receipts are retained under
  `/tmp/factory-capability-review-evidence/`; the fixture service was stopped.

## Checks and limits

90 focused existing tests passed: full routing-prompt assembly, WorkflowRuntime,
ticket launch/origin handling, FactoryPipeline, capture recovery and FactoryServer.
Workspace build/typecheck, changed-file Biome and `git diff --check` passed.
There are no new text-only tests; the existing full-prompt expectation was updated.

This drive validates actual injected instructions and native role behavior through
the CLI transport, not real Linear webhook delivery or the proposed selector
implementation. It preserves historical reports, launch permissions, frozen run
definitions, iteration budgets and existing human gates.
