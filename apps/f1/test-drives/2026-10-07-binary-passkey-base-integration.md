# Bob’s Factory binary and passkey base integration

Date: 2026-10-07. Draft PR [#34](https://github.com/Attraccess/bobs-factory/pull/34).
Tested head `1296c586` with main `9badbae6` and the reconciliation recorded in
this merge commit. The readiness receipt reported conflicts, no failing checks,
no new comments and no unresolved threads.

## Reconciliation

Retain main’s passkey protection, startup checkpoint recovery and dependency
cleanup alongside the renamed packages, binary dispatcher, cancellation and
saved-review recovery. Move the operator `factory-auth` command into the split
CLI, preserve `--origin` / `--session-hours` on local launch and rename the
Factory environment settings. Keep both changelog histories and historical
reports. Regenerate the lockfile from the combined manifests.

The first native binary smoke failed before `--version`: the bundled certificate
library loaded `tsyringe` without reflection support initialized. Initialize
`reflect-metadata` explicitly at the executable entrypoint, with a declared CLI
dependency. A fresh immutable candidate then passed all seven smoke assertions.
The original failed candidate remains in the evidence directory.

## Applicable F1 checks

The F1 skill applies to authentication and runner/session lifecycle. All agents
were simulated or scripted (`F1_AGENT_MODE=mock`); no inference, provider credits,
production services or live ticket mutations were used. Fresh homes and temporary
Git repositories isolated persistence and capacity. An initial startup fixture
hit the real legacy-capacity barrier; it was corrected to reference its own empty
legacy directory, without changing the safeguard or touching the host pool.

- Three startup-recovery scenarios completed after restart and explicit Retry:
  fresh initialization failure, legacy synthetic checkpoint, and confirmed thread
  failure. Completed clarification/scope receipts remained unchanged. Only the
  proven invalid checkpoint was removed; confirmed conversations resumed.
- A shared scripted Codex process received exactly one targeted interrupt after
  Stop and a delayed start notification following request timeout. The stopped
  run’s activity stayed unchanged; the surviving session completed. The child
  exited and instance capacity returned to zero active requests.
- Eight protected-dashboard checks passed in a fresh headless agent-browser
  session: local config/capacity rejection, remote authority rejection despite
  forged forwarding headers, cryptographic fixture enrollment, authenticated
  capacity read/write, completed Simple run with a simulated agent, authenticated
  run rendering, Recipes rendering, and logout protection.
- Opened and inspected the 390×844 setup and 1280×900 Recipes screenshots. The
  mobile setup is legible; authenticated Recipes shows the two-slot fixture pool.
  Closed the named browser and stopped the temporary worker.

## Binary and targeted checks

Native macOS ARM64 candidate built with pinned Bun 1.4.2. With PATH limited to
`/usr/bin:/bin`, it passed version/help, protected startup, local/remote config
rejection, operator enrollment in the selected home, refusal of recovery without
confirmation, and shutdown/listener release. No native agent was invoked.

The 99 Codex and 237 affected EdgeWorker tests passed. CLI tests, root build,
root typecheck, Biome CI and dependency audit passed; Biome retains 18 existing
warnings. Audit reports no known vulnerabilities after main’s dependency cleanup.

## Evidence and limitations

Scripts, logs, receipts, both binary candidates and screenshots are in
`/Users/jappy/.cyrus/factory/evidence/manual-7f0c7c6e-cca1-4387-b7ee-7d81e06997ba/ci-passkey-integration/`;
targeted check logs use the `ci-passkey-merge-` prefix in its parent directory.

The binary smoke covers macOS ARM64, not new native Intel or Linux certification.
Cryptographic fixtures establish server enforcement, not physical-device passkey
behavior. Existing real-agent and authenticated Cursor exclusions, redistribution
and platform publication limits, external hosted catalog verification and
unverified live ticket synchronization remain. No PR was marked ready or merged.
