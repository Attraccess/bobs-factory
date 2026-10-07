# Factory passkeys and refinement recommendations integration

Date: 2026-10-07. Taskbot #79, draft PR #27.
Tested tree: `0c5dfb983eb049d3521ba946f933d7ef1ccb1d0e` merged with
`b9974c8b121468e2075d82fd70a3ffa75d5cb757`, plus the conflict resolutions
committed with this report.

## Scope and isolation

Current main adds refinement recommendations, answer modes and question-batch
identity. This drive verifies those changes behind the passkey boundary while
preserving the accepted login-first and dedicated Settings UI. Conflicts in
CHANGELOG.md and the complete routing prompt retain both branches' intent.
No new authentication policy is introduced.

The built EdgeWorker uses a fresh temporary home/repository, loopback dashboard
port 46779 and provider port 46778. `F1_AGENT_MODE=mock` and injected
`f1AgentHandlers('mock', response)` emit deterministic question and continuation
results. No live provider or production instance is used. The named browser
`factory-ci79-recommendations-20261007` starts with `--headed false`; Playwright
connects only to that session's CDP endpoint. Two CTAP2 virtual authenticators
complete real registration/assertion ceremonies against FactoryServer.

## Executed results

All 11 recorded assertions passed:

1. Empty-store setup opens and unauthorized private API reads return 401.
2. Real operator-authorized registration opens the dashboard with no global key panel.
3. Settings reverifies an existing key and registers a distinct companion key.
4. Removing the companion reverifies the retained key and refreshes the list.
5. Removing the last key is rejected.
6. Logout exposes primary sign-in with setup folded and denies private API reads.
7. Normal sign-in ignores an unused code in folded setup.
8. Today has no global key-management panel.
9. Authenticated recommendations default to selected; reload leaves the run waiting
   with zero accepted answers. Custom text survives switching modes.
10. Explicit Send answers stores exactly the numbered Email answer, resumes one
    mocked continuation and produces exactly one script receipt. The saved run
    confirms completed status and `{accepted:true}`.
11. Direct Settings reload retains the dark mobile layout without horizontal overflow;
    final sign-out returns to login and protected run reads return 401.

Representative login, desktop Settings and mobile recommendation screenshots were
opened and inspected. Screenshots contain no codes, cookies or credential secrets.

## Commands and evidence

- `F1_AGENT_MODE=mock pnpm --filter cyrus-edge-worker exec vitest run test/FactoryAuth.test.ts test/FactoryAccess.test.ts test/FactoryPwa.test.ts test/FactoryWebClient.test.ts test/FactoryServer.test.ts test/Questions.test.ts test/WorkflowRuntime.test.ts test/FactoryPipeline.test.ts test/EdgeWorker.capture-recovery.test.ts test/prompt-assembly.routing-context.test.ts`: 221 tests across 10 files passed.
- `pnpm build` and `pnpm typecheck`: passed.
- `pnpm biome ci`: passed, retaining 29 existing nonblocking warnings.
- `git diff --check` and staged whitespace check: passed.
- Fixture: `F1_AGENT_MODE=mock CI79_EVIDENCE=<evidence> node <evidence>/fixture.mjs`.
- Browser: `agent-browser --headed false --session factory-ci79-recommendations-20261007 open http://localhost:46779`.
- Driver: `F1_AGENT_MODE=mock node <evidence>/drive.mjs`; completion and saved-receipt
  verification: `F1_AGENT_MODE=mock node <evidence>/finish-drive.mjs`.

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-09e877cd-6bbb-4ad8-9aec-85b6d59877e8/ci-recommendations-merge/`.
`results.json` contains the 11 passing assertions; `recommendation-result.json`
contains the completed synthetic run. Fixtures, drivers and screenshots are retained.
The driver required fixture-only corrections for HTTP 202 acceptance, the shortcut
in the button's accessible name, and omitted output bodies in the public run-detail
projection. The last execution completed the workflow before stopping on that
projection assertion; `finish-drive.mjs` checked the actual saved receipt and
completed the remaining UI checks. No product failure or product fix is claimed.
The corrected complete driver is retained for reproduction. Only the dedicated
browser and isolated fixture were stopped.

## Preserved dispositions and limitations

FACTORY-AUTH-001, QA79-CONFIG-001 and QA79-PUBLIC-001 remain resolved.
QA79-OBS-001 (connection wording) and QA79-OBS-002 (worker registration timing)
remain nonblocking observations. Historical physical-device/tunnel evidence is
preserved, not rerun: phone outcomes are operator-reported on an isolated public
share, with unspecified iOS version and accelerated expiry. Chromium emulation
and mocked generation do not establish physical Safari or live model behavior.
Production-origin enrollment remains rollout work. Live ticket synchronization
remains independently unverified and runtime-owned. This integration neither
approves nor merges the PR, changes production services or bypasses human review.
