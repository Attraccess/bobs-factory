# Factory passkeys with Codex startup recovery

Date: 2026-10-07. Draft PR [#27](https://github.com/Attraccess/bobs-factory/pull/27).
Tested head `1e37c4e6` with the merge of main `0de51ccf` and the changelog
conflict resolution included in this commit. Both changelog entries are retained.
Passkey code and the accepted sign-in/Settings fixes are unchanged.

## Applicable behavior and expected results

The inherited runner/session recovery changes require integration validation.
An embedded F1 EdgeWorker used a fresh temporary repository/home, provider RPC
port 46730 and protected Factory port 46731. `F1_AGENT_MODE=mock` was enforced.
Every runner was intercepted: ordinary roles used MockAgentRunner; Codex startup
failures used a controlled in-process backend or scripted legacy event mapping.
No native agent process, provider inference or production service was used.

Expected: a fresh startup failure creates no resumable checkpoint; Retry clears
only a proven invalid legacy checkpoint; a confirmed conversation remains
resumable. Restart and retry must retain completed roles, evidence and visit
counts. Protected HTTP reads must require a session throughout.

## Executed results

- All three issue/session flows completed after restart and authenticated Retry.
- Fresh capture resume IDs: absent, absent. Legacy: absent, synthetic ID, absent.
  Confirmed: absent, confirmed ID. Earlier history receipts remained identical;
  clarification/scope ran once per case and capture retained its first visit.
- F1 activity output and paged Factory activity remained available. All simulated
  results reported zero provider cost; instance active/queued slots returned to zero.
- Protected config reads returned 401 before fixture authorization on every
  restart. A fixture-scoped server session authorized retries; revoking it
  returned protected reads to 401. This session seed does not establish a new
  WebAuthn ceremony; previous cryptographic/browser evidence remains historical.
- 84 Codex runner tests and 199 focused EdgeWorker tests passed. Root build
  passed before the drive; required commit hooks cover build and typecheck.

Commands:

```sh
F1_AGENT_MODE=mock pnpm --filter cyrus-codex-runner test:run
F1_AGENT_MODE=mock pnpm --filter cyrus-edge-worker exec vitest run test/WorkflowRuntime.test.ts test/EdgeWorker.capture-recovery.test.ts test/AgentSessionManager.codex-runner-activity.test.ts test/FactoryServer.test.ts test/FactoryAuth.test.ts test/FactoryAccess.test.ts test/FactoryPwa.test.ts test/FactoryWebClient.test.ts
pnpm build
F1_AGENT_MODE=mock bun run <evidence-directory>/ci-startup-merge/drive.ts
```

Evidence: `/Users/jappy/.cyrus/factory/evidence/manual-09e877cd-6bbb-4ad8-9aec-85b6d59877e8/ci-startup-merge/`.
The driver, logs, receipts and three run/activity records are retained there.
Both listeners stopped cleanly. Historical reports and screenshots are preserved.
No UI was changed or new physical-phone/native-model behavior established.
Prior nonblocking QA observations and independently unverified ticket tracking
remain recorded. Fresh review and human approval remain required; no merge,
ready transition or production change was performed.
