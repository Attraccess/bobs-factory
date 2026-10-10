# User service operation

The existing packaged `bobs-factory` is the server-only runtime: no display,
Electron, Node/Bun installation or browser launch is needed. Static dashboard
assets remain included for remote clients. Prepared agents, Git and their native
credentials remain prerequisites under the same service account.

Installing a binary does not install, start or enroll an OS service. From that
account, explicitly install a definition and start it:

```sh
bobs-factory --home ~/.bobs-factory service install
bobs-factory --home ~/.bobs-factory service start
bobs-factory --home ~/.bobs-factory service status
bobs-factory --home ~/.bobs-factory service logs
```

`service install --mode local` instead starts shared guided onboarding; it never
opens a browser from the service. `start` preserves the existing webhook/server
configuration. The service captures the prepared account's PATH and reloads its
own home `.env`, preserving native agent stores. Checkout executables require an
explicit `--executable /absolute/path/to/packaged/bobs-factory`.

`enable` enrolls startup; `disable` stops and removes startup enrollment. On Linux,
this uses systemd **user** services. Boot and logout operation requires deliberate
account lingering (`loginctl enable-linger YOUR_ACCOUNT`), subject to host policy;
installation never requests it. On macOS this uses a GUI-domain LaunchAgent at
user login, without promising pre-login availability. Locked keychains, secure
enclave/passkeys, interactive provider logins and signing keys may need a logged-in
user. No root/system-daemon or pre-login macOS service is offered.

`stop` persists stopped intent before unloading/stopping the manager, preventing
crash restart or later login from undoing an explicit Stop. `start` is deliberate.
`restart` performs graceful stop then starts one worker. Native definitions use
10-second crash backoff; systemd additionally limits starts to three per two
minutes. Normal shutdown is not forcibly timed out. State homes have atomic,
process-identity ownership records; one worker owns each canonical home. A crashed
worker's inherited marker identifies detached/reparented descendants for verified
termination. Capacity lease reconciliation separately gates workflow admission.
Malformed/unverifiable ownership or remote execution remains a safety blocker.

`maintenance` persists suppression before stopping the manager. It must follow
an updater's authenticated intake freeze and verified idle check, never be used
to kill busy work for an update deadline. `resume` deliberately exits maintenance
after exact candidate/recovery verification. Closing/quitting a client does not
change service state, startup or update consent. `remove` preserves timestamped
service definitions/records, logs, config, workflows and native credentials.

PM2, manual launchd/systemd, Nix and external managers require a deliberate handoff:
retain the old definition, drain its jobs and descendants, stop/disable its old
owner, then install the new user service. Changed external definitions are refused;
Nix store executables stay Nix-owned. Older workers that predate atomic ownership
must be independently verified stopped; a missing lock is not evidence of that.
Never use both managers for one home. No automatic PM2/Nix migration is claimed.

Remote control reuses the existing protected dashboard topology/passkeys and
separate signed webhook ingress. Connect to that host's HTTPS dashboard, authenticate
there, and keep the tunnel/reverse-proxy under its own owner. This service CLI adds
no unauthenticated control/update endpoint. Multiple-instance UI work belongs to
Taskbot #84. Service/native reboot and logout receipts remain required before
calling this a validated deployment.

The owner installs a separate `.updates` companion user unit that runs
`service updates-run`. It survives worker maintenance and owns update activation
from outside the worker process. Deliberate Stop, disable and remove stop both
units. The desktop similarly starts a detached companion and persists deliberate
Stop suppression. Its crash restart is bounded to three attempts per companion
lifetime; verified stale worker ownership and marked descendants are reconciled
before replacement. Native launchd/systemd crash/startup validation remains a
required platform receipt; generating definitions or mocked manager calls does
not establish it.

### Update ownership and deliberate Stop

Permission to run a user service does not authorize replacement of its executable.
An installer-managed `PREFIX/bin/bobs-factory` link requires the matching
`PREFIX/lib/bobs-factory/records/bobs-factory-VERSION-TARGET.json` receipt and
canonical owned version layout. Installation binds that receipt's hash in the
service record; maintenance admission revalidates it. Desktop ownership similarly
binds its original per-home runtime receipt. Generic package-manager links and
ordinary executables can run through supported owner controls, but receive no
automatic update companion or executable replacement capability. Changed receipts,
external link targets and mismatched retained update identities fail closed.

Desktop Stop confirms in the UI, then the native runtime rechecks the maintenance
fence, executable, process start stamp and worker nonce under the same per-home
`lifecycle-operation.lock` used by updater admission and startup. Linux resolves
`/proc/PID/exe`; macOS resolves the full process command. Stop durably saves intent
before graceful shutdown. Automatic startup, crash recovery and rollback cannot
clear that intent. Only explicit reopen outside maintenance clears it. A stopped
rollback can require operator reconciliation; it never reports a healthy restarted
worker while suppression is active. Closing the window keeps the worker running.

These worker/frontend updates do not replace the Electron shell or its package.
The separate [complete-app updater](DESKTOP.md#complete-app-updates) implements
shell replacement while retaining the worker. Signed macOS app activation and
final-candidate native acceptance remain outstanding evidence gates.
