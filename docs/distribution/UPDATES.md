# Per-instance updates

Each selected backend keeps settings and update receipts in
`<factoryHome>/updates/state.json`, separate from immutable runtimes and native
credential/conversation stores. Stable defaults to **Notify / manual Install**;
nightly defaults to **Automatic when idle**. Each channel remembers its explicit
override. Reinstalling, closing a window and switching channels do not grant
manual Install consent or reset saved choices.

Use Settings → Updates on the selected authenticated backend, or:

```sh
bobs-factory --home /path/to/instance update status
bobs-factory --home /path/to/instance update settings --channel nightly
bobs-factory --home /path/to/instance update settings --policy manual
bobs-factory --home /path/to/instance update settings --pause
bobs-factory --home /path/to/instance update settings --resume --pin 1.2.0
bobs-factory --home /path/to/instance update settings --unpin
bobs-factory --home /path/to/instance update settings --channel stable --policy default
bobs-factory --home /path/to/instance --port 3457 update check
bobs-factory --home /path/to/instance --port 3457 update stage
bobs-factory --home /path/to/instance update candidate
bobs-factory --home /path/to/instance --port 3457 update install --candidate EXACT_ID --revision N
```

Offline status/settings use the local operator's filesystem authority. Running
check/stage/Install use the existing memory-only terminal session through the
loopback dashboard. Remote browser operations retain passkey/session, exact
origin, request-header and client-build checks. There is no webhook update API.
A client controls only its connected instance; desktop and remote hosts keep
independent identities and policy. UI drafts retain the existing client/PWA
protocol protections. A failed settings save retains the draft.

Pause cancels activation authorization, including queued automatic work. A pin
selects an exact version and prevents automatic activation; an intentional
manual Install still uses the same idle/compatibility checks. Clearing a pin or
resuming is explicit. Every settings revision invalidates previous manual
consent. New candidates replace older pending candidates without carrying their
consent forward. Intentional return from nightly to stable, or another downgrade,
requires Install even with a saved automatic stable override; compatibility
preflight must still pass.

The external owner supervisor calls `UpdateManager.tick()` on a bounded timer.
Release discovery polls every 15 minutes with exponential offline backoff capped
at six hours. Publication cadence is separate. Offline errors remain visible;
previously verified pending state survives. Discovery uses the canonical signed
published-release verifier, complete inventory, exact target/channel and frozen
source checks. Stage reauthenticates the immutable release, downloads only bound
assets, runs its verified archive installer into an isolated staging prefix and
probes the candidate version with a temporary home. No production link changes
occur during stage. An integrity/staging or trial failure suppresses that exact
candidate until deliberate `update install --retry` after inspection.

## Restart and recovery boundary

`UpdateLifecycle` is implemented by the external owner supervisor, not the
worker being replaced. Checkout, Nix and externally managed/system-package
installations must upgrade through their owner. The shared updater alone does
not implement those activation mechanisms. A manual Install queues consent;
it does not forcibly stop a busy worker.

1. Persist the exact candidate, previous identity and transaction before
   acquiring owner maintenance. Maintenance suppresses service auto-restart and
   freezes new dashboard/webhook intake. Already accepted work may finish and
   acquire its next role. Ticket retry timers pause; in-flight delivery finishes.
2. Check executing workflows, webhooks, agents/chats and capacity ownership.
   Under the capacity lock, verify zero executing/stopping leases and tagged
   descendants, then close admission. Waiting human review/answer gates are
   allowed. Never signal active work to meet an update schedule.
3. Preflight state compatibility in isolation and snapshot bounded compatible
   Factory-owned state. Native credential/conversation/signing stores and
   Factory authentication remain outside rollback. Observe config/profile,
   accepted definition/output/checkpoint/gate/answer/ticket and native-session
   preservation digests; concurrent filesystem edits must fail health/rollback
   comparison rather than being silently overwritten.
4. Recheck policy, pause, pin and exact consent at the atomic stopping boundary.
   Confirm old worker/descendant exit before switching the owned executable.
   Start one replacement with the same home/user, validate exact identity and
   preservation receipt, then release maintenance and resume retained work.
5. On failed trial, stop the replacement before restoring the previous executable
   and only compatible bounded Factory state. On rollback or maintenance failure,
   keep a durable recovery-required transaction and suppression for inspection.

Protected supervisor hooks are `POST /api/updates/maintenance` with
`{transactionId, action: "begin" | "end"}` and `GET /api/updates/drain`.
The transaction must match persisted updater state. Drain returns idle/busy,
capacity observations and `preservedStateSha256`; these are not unauthenticated
health shortcuts. A reboot with retained maintenance does not automatically
resume workflow/native execution before supervisor reconciliation.

`recover("operation owner stopped")` requires explicit confirmation and rejects
an operation lock whose recorded PID is still alive or cannot be inspected. It
reconciles interrupted pre-switch maintenance or rolls back an interrupted
switch. Never remove a live operation/state lock. A stale short settings lock
requires inspecting the interrupted save before removal; no PID-only automatic
lock stealing is implemented.

## Evidence and outstanding integration

The updater regression suite and mocked F1 drive cover policies, settings races,
busy/lease deferral, one controlled worker, preserved native checkpoint IDs and
human gates, failed trial/rollback and independent homes. They use controlled
candidates/supervisors and do **not** establish native OS service behavior or
release publication. The lifecycle lane supplies and separately validates the
owned service/desktop adapter. Final integrated macOS/Linux target receipts,
authentic publisher pins, protected signing and exact-candidate publication
remain necessary before rollout. No production signing key is generated here.
