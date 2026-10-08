# Web Push integration with the current Factory base

Date: 2026-10-07. Draft PR: [#35](https://github.com/Attraccess/bobs-factory/pull/35).
Tested merge of `2ec6450afc6c94a21264d3d64cf45f51b9839098` and
`ec130ae07aad06a7685463f6e282bcfe47489375`, including the resolved server,
capability prompt, prompt fixture, PWA tests and changelogs. Tested staged tree
before this report: `8cbc29b56494de19ecf3ac153b10f6bfcd96c43a`.
Factory web build: `6f066880d91656f35ef3c72f`.

F1 applies to the merged proxy admission and question workflow. The drive used
an isolated EdgeWorker, fresh temporary repository/home, F1 RPC on loopback
3648 and Factory UI on loopback 3647. `F1_AGENT_MODE=mock` and injected
`f1AgentHandlers('mock', ...)` covered every runner; the push sender recorded
payloads without contacting a provider. No live agent calls were made.

## Executed checks

```sh
pnpm build
pnpm biome ci
pnpm --filter cyrus-edge-worker exec vitest run test/FactoryPwa.test.ts test/FactoryServer.test.ts test/FactoryPush.test.ts test/FactoryNotifications.test.ts test/prompt-assembly.routing-context.test.ts
pnpm -r test:run
pnpm --filter cyrus-ai exec vitest run --testTimeout=30000
F1_AGENT_MODE=mock node <evidence-directory>/ci-merge-push.mjs
```

- Both configured trusted and public proxy hosts admitted configuration reads,
  device registration and test requests using their exact HTTPS Origin.
- Foreign Host/Origin and cross-proxy writes returned 403; missing request
  headers returned 403 and stale build headers returned 409.
- The real F1 issue/session/activity path created `issue-1` / `session-1`.
  Its deterministic runner produced a waiting question and retained its
  refinement recommendation. Two device-specific question sends were recorded.
- Public-proxy device disable and trusted-proxy bodyless DELETE returned 200.
  Testing the disabled target returned 409. The merged server remains loopback.
- A fresh `agent-browser --headed false --session ci35-merge-20261007` loaded
  the merged dashboard and opened Notifications. The screenshot was visually
  inspected; the title, permission/device status and controls rendered correctly.
- Build, all 65 focused tests and Biome passed; Biome retains 29 existing warnings.
  The monorepo run passed every package and F1 suite, but eight CLI release tests
  exceeded the local 5-second default. The complete CLI rerun passed 162 tests
  with a 30-second timeout; no assertions or production/test code were weakened.
- Fixture transport was corrected to use `node:http` for explicit Host headers.
  Browser subprocesses run asynchronously so the embedded server can respond.

## Evidence and limits

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-56a8faa8-c83d-4083-a81b-b98174357df8`.
Driver: `ci-merge-push.mjs`; receipts: `ci-merge-results.json` and
`ci-merge-activities.json`; screenshot: `ci-merge-notifications.png`.
Logs: `/tmp/ci-fix-35-{build,focused,tests,cli-retry,biome,f1}.log`.
The final drive completed at 13:36:48 UTC; browser and worker were stopped.

This integration check uses mock subscriptions/sends and HTTP transport with
explicit HTTPS Origin headers. It does not repeat the earlier authenticated
zrok2 TLS validation or prove native notification delivery. Preserve the
[protected HTTPS evidence](../../../docs/WEB_PUSH_HTTPS_QA.md), physical-device
and production-Tailscale limitations, accepted node-forge/braces exception and
tracker snapshot discrepancy. No merge to main, PR readiness change or ticket
lifecycle mutation was performed.
