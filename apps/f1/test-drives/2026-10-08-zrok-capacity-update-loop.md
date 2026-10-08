# Capacity saves through a public proxy

Date: 2026-10-08. Functional commit: `513a2d47a09848288fd9f171a86ba64e0c209b1f` (equivalent working tree tested before commit). Dashboard build: `11adff5e10212eb558ade9ec`.

## Applicability and scenario

F1 applies to the protected settings API and client connection state. An isolated CLI-platform EdgeWorker used a fresh F1 repository, mocked agent handlers and an isolated server-side authentication fixture. A loopback proxy reproduced the observed public-edge behavior: numeric `limit` bodies receive HTML 403 with no Factory build header. The exact hosted frontend rule is unknown. No production credentials, trackers or native providers were used.

## Commands and assertions

```sh
apps/f1/f1 init-test-repo --path <diagnosis-directory>/f1/repo
F1_AGENT_MODE=mock bun run <diagnosis-directory>/capacity-f1-fixture.mjs
BOBS_FACTORY_PORT=3600 apps/f1/f1 ping
BOBS_FACTORY_PORT=3600 apps/f1/f1 status
agent-browser --executable-path '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' --session bob-capacity-f1 open http://localhost:4499
```

After installing the isolated fixture session in the test browser:

- Opened Settings → Instance capacity and saved 6 through the real form. The proxy accepted the new `concurrency` payload; the EdgeWorker persisted limit 6 with no active/queued requests.
- Injected one HTML 403, then tried saving 5. The UI displayed the blocked-request error and Retry connection instead of requiring a PWA update. The save remained disabled until reconnection.
- Retried the connection; the open form retained 5. Resubmission saved 5, and reloading read back 5.
- The F1 RPC server reported healthy/ready.
- All 82 targeted FactoryWebClient, FactoryServer, FactoryPwa, FactoryAuth and FactoryAccess tests passed. New client regressions failed before the fix. Existing different-build and passkey protections remained covered.
- Biome, repository build/type checks and diff checks passed.

## Evidence and cleanup

Private diagnosis directory: `/Users/jappy/.local/state/bobs-factory-update-loop-20261008`. Receipt: `f1-verification.json`; fixture: `capacity-f1-fixture.mjs`. Browser snapshots confirmed the saved field, disabled save after rejection, retry action and successful readback. The isolated Brave session closed and the worker stopped gracefully.

This validates mocked-agent orchestration and the isolated authentication fixture, not a physical passkey ceremony or live inference. The existing production passkey store is untouched.
