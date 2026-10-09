# Native delivery and onboarding after PR #56 integration

**Date:** 2026-10-09. **Result:** PASS — mocked/scripted agents and controlled
provider transport. Tested checkout: `598e0eccc27cdf43d70366c11e0f9907ec839a40`,
with the pending merge of `0c6b9e04` and its integration changes applied.
This is dirty-worktree evidence, not a clean binary release result.

F1 applies because the combined changes affect onboarding, native provider
delivery, finalization admission, CI routing and persisted retry recovery.
The [historical CI report](2026-10-08-delivery-ci-supervision.md) and its original
fixture remain unchanged. The new [native fixture](assets/factory-delivery-ci-supervision-native.mjs)
replays those scenarios through `GITHUB_API_COMMAND` JSON REST/GraphQL operations.

## Commands and fingerprints

```sh
pnpm --filter bobs-factory-edge-worker build
F1_AGENT_MODE=mock F1_EVIDENCE_DIR=/tmp/f1-native-delivery-ci-20261009 \
  bun apps/f1/test-drives/assets/factory-delivery-ci-supervision-native.mjs
F1_AGENT_MODE=mock F1_ONBOARDING_PORT=3650 \
  bun run apps/f1/test-drives/assets/simple-install-onboarding.ts
bun apps/f1/test-drives/assets/factory-build-identity-111.ts
bash -n scripts/smoke-binary.sh
pnpm exec biome check apps/f1/test-drives/assets/factory-delivery-ci-supervision-native.mjs
git diff --check
```

All passed. Both drives compare their fingerprint before and after execution;
the formula is `SHA256(concat(sorted path + NUL + SHA256(file bytes) + newline))`.
Their path inventories are retained in the fixtures and raw evidence.

| Drive | Tested fingerprint |
| --- | --- |
| Native CI: 28 source, compiled and fixture paths | `631dc78db99aa89211a8cf26191c31fe89b707b79ec8d5c31903cf8a561f22ce` |
| Onboarding: 30 runtime source paths | `969f24bec05590e8f336936899a05c179b8dca8b8fabf1dee1a9abe7f06540cd` |

Native CI recorded **12 snapshots, 13 scripted role visits, 117 controlled API
operations and 49 real Git transport calls**. Its authenticated Factory API uses
Fastify injection and opens no listening port. Onboarding used the real EdgeWorker
on ports 3650/3651 and **27 controlled GitHub HTTP requests**. Both recorded zero
`gh` executions, live forge mutations or paid model calls.

## Observed results

- Parallel implementations completed while overlapping finalization waited.
  A concurrent base change caused one integration and another code review;
  capture, guide and actual handoff publication each ran once per delivery.
- Proven infrastructure failures retried outside agents. Unknown code failures
  entered diagnosis. A real isolated source commit/push preceded separate CI
  assistance, with failed checks and `approved: false` retained.
- Native title PATCH corrected metadata without changing HEAD or issuing a Git
  commit/push. The unchanged-SHA Actions retry then completed.
- Two retries exhausted the bounded budget. Restart retained their receipts
  and sent no third request. An uncertain accepted retry was not resent after
  restart or an assistance answer; fresh passing checks permitted completion.
- Pending CI retained a wait leaf without an agent capacity request; cancellation
  stopped the wait cleanly.
- Protected onboarding denied signed-out/forged-origin writes and refused to
  save a token lacking readiness access. Valid project, agent, private token,
  passkey and session state survived restart. Issue/worktree/activity processing
  and the ordinary approved-SHA native merge guard passed.
- Attempt provenance correctly reported development runtime identity with
  `packaged: false` and unknown commit, target and resource digest. The separate
  compiled identity check retained distinct commits at the same version.

## Artifact checks and limits

The extended native smoke now compares both `/version` and `/api/version` against
the adjacent `build.json` for version, commit, dirty flag, target and resource
digest, and requires `packaged: true`. Its shell parser accepted matching identity
and rejected wrong-commit, development and missing identities. Existing startup,
access, assets, helper and restart checks remain. A fresh compiled native artifact
must still execute that extended smoke; this report does not claim it did.

CI uses the real runtime/tools and local bare Git origin with scripted agent and
native API command boundaries. Empty Actions retry responses follow the normalized
transport contract; actual HTTP 201 handling has separate provider regression
coverage. Capture/reviewer/guide outputs do not claim real model assessment or
screenshots. Onboarding uses software WebAuthn and controlled HTTP, not physical
passkey hardware or a live GitHub account. Merge queues, live coding agents,
tracker delivery, all four native targets and full release readiness remain
separate checks. No public release was published.

Raw CI evidence is `/tmp/f1-native-delivery-ci-20261009/factory-delivery-ci-supervision-native.json`.
Its isolated state remains at `/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/f1-delivery-ci-supervision-Qi2svy/`.
Onboarding output is `/tmp/f1-native-onboarding-20261009.log`; its successful
temporary state was removed after shutdown.
