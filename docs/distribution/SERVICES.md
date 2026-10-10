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
