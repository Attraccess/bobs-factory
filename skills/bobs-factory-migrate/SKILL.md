---
name: bobs-factory-migrate
description: Migrate an existing Cyrus installation to Bob’s Factory, or recover an interrupted migration. Discover service management, preview changes, verify backups and preserve native conversations before cutover.
---

# Migrate Cyrus to Bob’s Factory

Use an existing assistant with access to the installation. Work through the
steps below in order. Use private local artifacts for configuration and secrets;
show only redacted findings in conversation. Keep host authentication, SSH/GPG
agents, Git identity/signing configuration, keychains and agent credentials intact.

## Discovery and preview

1. Identify the effective service account, installation version, state home,
   config/env files, external repositories, worktrees, services (foreground,
   pm2, systemd or launchd), ports and webhook/tunnel registrations. Inspect
   service definitions without printing secret values. Record which processes
   and descendants belong to each worker. Ask only for facts not discoverable
   or destination conflict choices. Finish with an inventory of every consumer.
2. Run `bobs-factory migration inspect --source OLD_HOME --destination NEW_HOME`.
   Then use `preview ... --output PRIVATE_MANIFEST.json`. The manifest contains
   filenames, hashes, modes and blockers, never credential values. Inspection
   does not create a destination or start a service. Preserve source files.
3. Resolve destination conflicts explicitly. Automatic apply requires an absent
   destination. For an existing home, propose a per-file reconciliation with
   backups of both sides; retain distinct run IDs and reject collisions. Never
   use a recursive overwrite to resolve a collision.

## Maintenance and preservation

4. Agree a maintenance window, stop intake and disable automatic service restart.
   Drain active work through the existing worker. Use its shutdown/checkpoint
   behavior and inspect waiting clarification/review, queue order and external
   effects. Verify both workers and descendants stopped. An uncertain lease is
   a blocker, not permission to delete coordinator files. A custom/shared capacity
   directory requires a separate verified backup and coordination of all consumers.
   `CYRUS_CAPACITY_DIRECTORY` / `BOBS_FACTORY_CAPACITY_DIRECTORY` in the source
   `.env` or helper environment block automatic apply: the replacement uses only
   `<factoryHome>/machine-capacity`. After verifying every consumer stopped, back
   up both the selected pool and any existing default pool. Resolve collisions or
   shared-instance ownership explicitly; preserve policy, request identities and
   queue order in the source home's `machine-capacity`. Remove obsolete overrides
   from env files, the helper environment and replacement service definitions;
   regenerate inspect/preview and require coordinator validation to pass before
   apply. Keep the verified custom-pool backup for recovery.
5. Back up source state, config, env, service definitions, destination files being
   affected and relevant native conversation stores with mode 0700 directories.
   Include existing `factory/auth` files and their configured dashboard origins.
   Verify bytes, permissions and symlinks. Keep originals. The helper copies
   source state and approved external files through a preservation plan. Read
   [preservation.md](preservation.md) when external stores, service definitions or
   saved native sessions are present. Backups containing secrets stay local.
6. Identify native continuation lookup for every saved Claude/Codex/Gemini/Cursor/
   OpenCode session. Moving a workspace may change project-keyed lookup. Copy
   only the required conversation data using verified provider behavior; leave
   credential files untouched. Test continuation with the original session ID and
   relocated workspace before declaring preservation. Provide verified continuation
   records through `--preservation-plan`; do not remove session
   IDs to bypass it. If a provider store cannot be accessed or safely mapped, stop
   before cutover and report exactly which sessions need access or preservation.

## Apply and cutover

7. For a supported empty-destination installation, run
   `bobs-factory migration apply --manifest PRIVATE_MANIFEST.json --backup BACKUP`.
   The helper rechecks source hashes and consumers, verifies its backup, stages
   structured field/env changes and records an operation journal before copying.
   It preserves source state and never starts a service. Unsupported installations
   require assistant-managed operations using the same preservation requirements;
   automatic apply is intentionally fail-closed, not exhaustive migration coverage.
8. Inspect the result. Transform only owned operational paths/fields, env keys,
   tool references and recognized stock recipe names. Preserve custom prompts,
   accepted run definitions, transcripts, secrets, run/session IDs, completed
   receipts, approvals, waiting gates and tracker synchronization receipts.
   Rename approved repository setup/teardown hooks explicitly. Repair moved Git
   worktrees with the helper's verified Git repair mappings and validate both main
   repository and worktree links. Source hooks are never compatibility aliases.
9. Update the approved service definition to one `bobs-factory` executable/home.
   Use the exact canonical destination printed in the manifest for the service
   home. Queue identities use that path; alternate symlink spellings can create
   different identities for the same directory.
   Preserve ingress URLs, provider registrations and direct verification secrets.
   Hosted Cyrus enrollment requires explicit independent OAuth/webhook conversion;
   never send migrated secrets to a new hosted service. Configure dashboard access
   as described below before starting the replacement; keep webhook ingress separate.
   Enable/start only the intended replacement after the old consumer and
   descendants are proven stopped.
10. Verify dashboard/API, configured integrations, workflow selection/permissions,
    waiting-run recovery, queue order, native continuation and ticket identity.
    Check unauthenticated dashboard API denial and successful passkey sign-in.
    Completed steps stay completed. Interrupted scripts/external tools retain
    reconciliation semantics; do not promise exactly-once execution. Finish only
    when preservation checks pass or clearly report the remaining blocker.

## Dashboard access after cutover

Every dashboard address, including localhost, requires a passkey session for data,
live updates, media and actions. For remote access, configure the exact HTTPS browser
origin with `--origin https://YOUR_HOST` for local launch or
`BOBS_FACTORY_FACTORY_ORIGIN=https://YOUR_HOST` for configured services. The proxy
must preserve that authority and browser Origin; unconfigured origins are denied.
Webhook ingress retains its separate provider signature checks.

Preserve existing authentication files and origin settings. For first setup, start
the replacement, privately read the ten-minute, single-use `token` value from
`<home>/factory/auth/enroll.json`, and enter it in the setup screen to create a
passkey. Localhost and the public hostname need separate passkeys. For another
enrollment, use Settings with a recent passkey verification, or generate a new code
on the service machine with `bobs-factory --home /absolute/service/home factory-auth`.
Use the running service's home; codes are invalidated on restart and stay out of
prompts, tickets and screenshots.

If configured origins change, restore the original configuration or deliberately
recover authentication. For lost keys or corrupt authentication state, run
`bobs-factory --home /absolute/service/home factory-auth --recover --confirm
"RESET FACTORY AUTHENTICATION"`. Recovery revokes all passkeys and sessions while
preserving runs and integrations. If startup was blocked, start the service again;
then re-enroll with the new code. Follow
[passkey setup and recovery](../../docs/FACTORY.md#passkey-access-and-first-setup)
for the complete access contract. Confirm sign-in before declaring cutover complete.

## Recovery

Read `BACKUP/journal.json` after failure. Keep the verified source backup and any
partial destination. Stop replacement consumers and descendants, disable restart,
then use `bobs-factory migration restore --backup BACKUP` where supported. Restore
preserves the destination under `destination-recovery`; it does not erase new work
and preserves owned native-copy changes in `native-recovery`. It restores Git
backlinks and external files explicitly selected in `restorePaths`. Reconcile
other assistant-managed service/store changes before enabling the original
consumer. Verify one active pool and one consumer. Retain backups until the user
explicitly elects to remove them.

There is no old command alias, implicit old-home fallback or deprecation phase.
Automatic updates, Windows, zrok2 (#39) and independent identity overlays (#57)
are separate work. See
`docs/PRODUCT_CONTRACTS.md` and `docs/distribution/README.md` in the checkout.
