# Web Push integration with the Bob’s Factory fork

**Date:** 2026-10-08
**PR:** [#35](https://github.com/Attraccess/bobs-factory/pull/35)
**Tested tree:** staged merge of `a79d19938372f337eb41b71488cde75403db883b`
with base `a5ff0910395426ae6967d9637cb2b3d873bbed7a`, including the integration fixes.
The existing Web Push reports and accepted protected HTTPS evidence are preserved.

## Changed behavior and applicability

The merge brings in the Bob’s Factory fork, compact role context and current CI
revision recovery. Web Push now uses `factoryHome`,
`BOBS_FACTORY_FACTORY_PUSH_SUBJECT` and the renamed HTTPS origin settings.
The capability prompt, complete prompt fixture and operator instructions agree.
Both sides’ changelog entries remain.

F1 applies to the combined worker, session and notification paths. The expected
behavior is fresh question/completion delivery to eligible devices, persistent
identity across restart and protected notification destinations. Context-test
changes retain all assertions, handle both launcher argument layouts and allow
15 seconds for the multi-megabyte full-history read.

## Executed drive

The driver creates a fresh repository, Factory home and legacy-source fixture
check directory. The initial attempt correctly refused to start against the
host’s live legacy coordinator. Isolating that check to the temporary fixture
matches the repository test setup; no production coordinator was changed.
Agents use `F1_AGENT_MODE=mock` with injected `MockAgentRunner` handlers.
The real worker constructor creates its push store from the renamed contact
setting in the selected home, with mode `0600`. A recording sender replaces
network delivery before device registration. Factory and RPC bind to loopback.
The temporary repository has no remote, so worktree preparation uses local main.

```sh
env -u BOBS_FACTORY_INTERNAL_EXECUTABLE F1_AGENT_MODE=mock node /Users/jappy/.cyrus/factory/evidence/manual-56a8faa8-c83d-4083-a81b-b98174357df8/ci-fork-push.mjs
```

Passed assertions:

- Unauthenticated push/config requests return 401; two fixture devices register
  through the configured HTTPS authority and Origin request guards.
- A test is accepted by the recording sender; a mocked F1 issue/session creates
  one new question event per device and retains its recommendation.
- A fresh headless browser shows sign-in at the notification destination.
  A persisted fixture session restores that route and refreshes the question.
- The Notifications dialog renders both registered devices. The captured image
  shows the visible dialog area; device controls continue in its scroll region.
- Revocation hides protected questions and clears private drafts while preserving
  device opt-out and deferred cleanup.
- After one device is disabled, explicit answer submission completes the workflow
  and only the remaining device receives completion.
- Bodyless device deletion succeeds; testing a disabled device returns 409;
  revoking the HTTPS-bound fixture session rejects further status reads.
- Restarting the push observer preserves stored keys/bookkeeping and sends no
  replay. The named headless browser and worker stop in the driver’s finalizer.

## Repository checks

- Frozen-lockfile installation and root build passed.
- `env -u BOBS_FACTORY_INTERNAL_EXECUTABLE F1_AGENT_MODE=mock pnpm --workspace-concurrency=1 -r test:run --maxWorkers=2`: 2,754 passed, two existing skips.
- The snapshot isolation test also passed with the inherited packaged-executable
  setting, exercising the other launcher argument layout.
- Biome passed with 18 existing warnings; dependency audit found no vulnerabilities.
- `git diff origin/main --check` passed. Upstream license texts and historical
  reports remain byte-preserved, including their existing whitespace.

## Evidence and limits

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-56a8faa8-c83d-4083-a81b-b98174357df8`.
Driver, final log, results, activity receipt and inspected screenshots use the
`ci-fork-` prefix. Repository test logs use `ci-fork-tests-final.log`.

This is simulated-agent evidence with synthetic subscriptions and recording
sends. HTTPS authority enforcement is exercised through actual loopback HTTP
requests with the configured Host/Origin, not a new production proxy deployment.
Browser authentication uses persisted fixture sessions, not a passkey ceremony.
Native foreground/background receipt, trusted OS notification clicks, physical
devices, production Tailscale deployment and live tracker synchronization remain
unverified. The tracker snapshot discrepancy remains a limitation.

## Follow-up: explanation identity regression

The merged revision `9dbfc6e8d7c234ab8b0ecac328d0aad16097dd56` passed
[CI on Node 22 and 24](https://github.com/Attraccess/bobs-factory/actions/runs/37699623556).
An additional integration reproducer then found that explaining a pending question
sent a duplicate alert: two devices received four question payloads instead of two.
The first two were the new decision; the next two only repeated its rephrased wording.

The follow-up tested tree is `9dbfc6e8` plus the fix to use matched saved explanation
provenance when deriving question identity, including nested workflow frames.
Stale display provenance falls back to the actual new questions. Answer count
still distinguishes subsequent decision waves. The capability reference and
complete prompt fixture now explicitly describe this behavior.

```sh
env -u BOBS_FACTORY_INTERNAL_EXECUTABLE F1_AGENT_MODE=mock node /Users/jappy/.cyrus/factory/evidence/manual-56a8faa8-c83d-4083-a81b-b98174357df8/ci-fork-explanation-push.mjs
```

The same reproducer passed after the fix: explaining the decision kept two question
payloads, recorded no accepted answer and retained the pending decision. The
subsequent explicit answer completed the run and sent only one completion to the
enabled device. All other authenticated API, browser, restart and cleanup assertions
also passed. Inspected the fresh Notifications screenshot; its scroll area retains
the same layout. No native browser push service or paid agent was invoked.

Final focused checks passed: 126 push/runtime tests, five complete routing-prompt
tests, the EdgeWorker build and Biome. Root build/typecheck run in the commit hook.
Evidence uses `ci-fork-explanation-`: red/green logs, driver, results, activities,
focused test logs and the inspected Notifications image. The limitations above
remain unchanged. Final GitHub CI is evaluated on the follow-up commit, not the
already passing merge commit.
