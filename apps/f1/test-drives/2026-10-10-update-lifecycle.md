# Persisted instance updates — mocked F1

Source checkpoint: `6b191095` on `feat/update-lifecycle-119-120`, based on
`4324a9fe` (release evidence PR #79 included). Date: October 10, 2026.
Taskbot [#119](https://taskbot.apps.janjaap.de/p/bobs-factory/t/119) and
[#120](https://taskbot.apps.janjaap.de/p/bobs-factory/t/120).

F1 applies because runtime intake, admission, checkpoint preservation and update
recovery changed. This drive uses production compiled WorkflowRuntime,
MachineCapacity, UpdateDrain and protected FactoryServer handlers with mocked
agents and an in-process lifecycle adapter. It never starts a provider CLI,
signals live work, touches the production home or changes an OS service.

```sh
mkdir -p apps/f1/test-drives/assets/2026-10-10-update-lifecycle
F1_AGENT_MODE=mock F1_TESTED_COMMIT=6b191095 \
  F1_EVIDENCE_DIR="$PWD/apps/f1/test-drives/assets/2026-10-10-update-lifecycle" \
  node apps/f1/test-drives/assets/update-lifecycle.mjs
```

[Machine-readable receipt](assets/2026-10-10-update-lifecycle/update-lifecycle.json)
records seven passes and peak controlled runtime ownership of one:

1. Busy accepted work postpones replacement without Stop.
2. A real capacity lease and controlled Node descendant postpone replacement;
   the descendant exits naturally, without a signal.
3. Unauthenticated access is rejected; maintenance freezes new intake; a
   concurrent change to manual policy cancels pending automatic activation.
4. A successful controlled replacement retains frozen workflow definitions,
   native checkpoint identity, answer batch and waiting human review gate.
5. Failed health rolls back retained run/runtime state without duplicate workers
   or accepting either human gate.
6. Answer continuation receives the same mock native session ID.
7. A second instance retains independent settings and candidates.

Additional checks: 78 relevant unit tests passed (UpdateManager,
PublishedUpdateSource, MachineCapacity, FactoryServer and TicketTracking);
mandatory precommit monorepo build/typecheck passed; changed-file Biome passed.
Separate CLI processes preserved nightly/manual and stable/automatic overrides
through channel changes and pause/resume. Canonical key synchronization and
signature module syntax checks passed. No dependencies changed.

A real browser against a temporary authenticated fixture loaded the compiled
settings page and saved manual nightly; the backend and visible effective policy
both changed. [Screenshot](assets/2026-10-10-update-lifecycle/settings.png).
The fixture session is synthetic and the fixture server was stopped afterward.

Initial harness attempts exposed Bun 1.3.5 injection incompatibility; the drive
was corrected to use Node and compiled production handlers. A first frozen run
completed assertions but failed writing to a missing evidence directory; creating
the directory and rerunning produced the receipt above. These are not native
activation receipts. An attempted native build refused installed Bun 1.3.5
because the build requires 1.4.2; no version check was bypassed.

## Acceptance mapping and remaining evidence

| Ticket criterion | Implemented/check evidence | Remaining integration evidence |
| --- | --- | --- |
| #119 policy defaults, manual consent and busy Install | Durable per-channel overrides, candidate/revision consent; manager tests and F1 busy/policy cancellation | Actual supervisor tick/activation wiring |
| #119 selected-instance CLI/UI and pending reconciliation | Backend-scoped API, CLI persistence smoke, browser settings save; pause/pin/channel race tests | Final integrated multi-instance native drive |
| #119 shared check/stage/apply/result/recovery | Persisted transaction contract, candidate quarantine and explicit dead-owner recovery; tests | Lifecycle-owned authenticated supervisor apply/recover entry points and interruption trials |
| #119 atomic intake/work/descendant coordination | Persisted maintenance, accepted-intake counting, final capacity admission fence; controlled descendant F1 | Actual OS ownership/restart suppression trial |
| #119 exact verification, compatibility, stop/start/health | Canonical signed inventory verifier/stager; structural adapter sequencing and policy race tests | OwnedUpdateLifecycle preflight/stop/link/start/health integrated proof |
| #119 ownership boundaries | Unsupported runtime instructions and no worker self-stop; adapter is external | Lifecycle tests for launchd/systemd/desktop and unsupported owner instructions |
| #119 previous runtime and compatible rollback | Durable previous identity/snapshot contract, controlled rollback preserves gates | Bounded native snapshot/restore excluding auth/native stores through lifecycle adapter |
| #119 pending/failures/retry | Visible phases/errors, capped backoff, bad-candidate suppression, explicit retry | Final native failure/recovery receipts |
| #119 preservation scenarios | Seven F1 passes plus interruption/concurrency/default/override tests | Real native conversation continuation and four-target final payload |
| #119 protocol/drafts and independent hosts | Existing protected client boundaries retained; failed save retains draft; per-home tests | Integrated desktop client/runtime combination |
| #120 durable identity/policy/status | Persisted schema and selected backend UI/CLI, process restart smoke | Installation-entry handoff from packaging and actual upgrade |
| #120 eligible target/channel releases | Canonical complete signed release resolver, reverified staging, wrong-target/untrusted-key checks | Authentic publisher key and actual complete stable/nightly releases |
| #120 subscription and effective policy application | Later settings, defaults/overrides and shared coordinator tested | Installer handoff and owned automatic replacement |
| #120 cadence/offline/coalescing | 15-minute poll, capped exponential backoff, newest eligible target coalescing; tests | Lifecycle supervisor scheduled tick integration |
| #120 pause/pin/reconciliation | Candidate consent invalidation plus revision checks through awaits; tests and F1 | Final integrated race drive |
| #120 stable return | Explicit downgrade consent and compatibility contract; tests/docs | Actual older stable compatibility and trial |
| #120 remote targeting/separate desktop | Backend-scoped controls and independent home evidence | Native desktop/multi-instance integrated proof |
| #120 full install/subscription/replacement validation | Local state machine, CLI/UI and mocked F1 evidence above | Signed install → newer nightly → actual owned replacement on final native targets |

The lifecycle lane owns the actual external adapter and service/desktop commands;
packaging owns installation entry points. Fail-closed availability alone is not
accepted activation. Neither ticket is acceptance-complete from this receipt.
Old native artifacts at `d982159b` do not validate this payload. Final integrated
native builds, desktop targets, authentic signing prerequisites and publication
remain separate under #116/#117; this lane neither publishes nor merges.
