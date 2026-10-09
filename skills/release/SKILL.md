---
name: release
description: Prepare, sign, validate or recover a Bob’s Factory binary release candidate when the user requests release work.
---

# Binary release candidates

Read `apps/cli/RELEASING.md`, `docs/distribution/README.md` and
`docs/distribution/PUBLIC_RELEASES.md` before release work. The public release
procedure is authoritative for candidate identity, key rotation, evidence,
approval and interrupted-publication recovery.

1. Freeze the candidate once. Nightly uses eligible changed main and its allocated
   version; stable promotes the latest complete signed published nightly's frozen
   source. Keep candidate digest, runtime source and reviewed tooling revision.
2. Build and validate the exact version on all four native targets. Stable rebuilds
   need fresh byte-bound evidence. Import actual review, migration, source/license
   and full-payload F1 assessments. Use simulated agents and controlled protocols;
   live tests require explicit credit authorization and are never a release gate.
3. Prepare without mutation or signing privileges. Report missing gates and keys
   as blockers. Review the retained assets and publication-plan digests.
4. Sign only in separately approved protected infrastructure. Stable publication
   additionally requires approval of its exact frozen candidate and signed asset
   digest. Automatic nightlies require separate rollout activation and the same
   eligibility/evidence gates. Missing authentic pins are rollout blockers.
5. Recover using the exact retained inventory and receipt. Reconcile matching
   tags, drafts and assets; preserve conflicting immutable state for inspection.
   If publication succeeded but Pages failed, retry only synchronization.

Completion means the requested stage has passed its real checks, with concrete
remaining blockers stated. Implementation validation leaves publication disabled
and production installations untouched. Workspace npm packages remain private;
upstream publishing scripts stay archived. Preserve native credentials, session
IDs, checkpoints, worktrees, evidence and attribution.
