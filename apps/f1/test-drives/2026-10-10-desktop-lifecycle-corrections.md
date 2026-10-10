# Desktop lifecycle corrections — October 10, 2026

PR [#85](https://github.com/jappyjan/bobs-factory/pull/85) remains draft. Taskbot
#121/#122/#124 remain in progress. This report preserves the distinction between
implemented corrections, exact native observations and unfinished acceptance.

Production correction source is `84f2b98575357ebde3b094967ca0e1bfa72c5aa8`.
It includes updater outcome source `815c4515ef7bffa09c18ebe7bb31bf197bb55a2e`.
Upstream `09173e87` changes only native test-log sanitation; `16e60465` adds its
report/receipts. Later desktop test changes wait for the completed Stop dialog
before probing restart suppression. None changes production behavior after84f2.
The combined checkout is `/tmp/bobs-factory-lifecycle-integration`; the PR checkout
is `/tmp/bobs-factory-desktop-121`. Root and production services remain untouched.

## Four findings from independent review1069

| Finding | Correction and current proof |
| --- | --- |
| External generic symlink incorrectly replaceable | Installation permission is separate from update capability. Exact installer/desktop link layout, original regular operator-owned receipt and bound receipt hash authorize replacement. Constructor, maintenance admission, startup and link switch revalidate provenance/current durable identity. External executable services remain runnable without automatic updater enrollment. Real temporary filesystem regressions prove generic links rejected and changed receipts revoked. Separate signed integration validates the genuine shell-installer receipt. |
| Invalid quoted systemd WorkingDirectory | Serialize this directive as a raw absolute path with escaped specifiers; command/environment arguments retain their own quoting. Reject paths with unsafe line-ending semantics. [Run38074543720](https://github.com/jappyjan/bobs-factory/actions/runs/38074543720), source4c468a70, passes actual disposable systemd/launchd and packages on all four targets. Later6ed and84f2 manager steps also pass; their Electron-stage failures remain separate. |
| Linux Stop treats procps basename as a pathname | After UI confirmation the native CLI resolves `/proc/PID/exe` on Linux and the full process command on macOS, verifies start stamp and nonce, then signals only the desktop-owned worker. CLI regression uses an actual controlled child. Final Linux Electron menu proof is pending the corrected fixture. |
| Stop dialog races maintenance and resurrects worker | Native final admission shares lifecycle-operation.lock with maintenance admission and startup. Fence/identity rechecks and durable Stop intent occur after confirmation, before graceful signal. Startup, crash restart and rollback startup honor suppression. Only explicit reopen outside maintenance clears it. Regression proves fence rejection, unchanged worker, stale nonce rejection, Stop/reopen intent and no rollback restart. Actual84f2 mac menu rejection and subsequent explicit Stop passed before a premature post-Stop fixture assertion failed on the still-held guard. |

Authenticated readiness additionally waits for exact `/api/version` runtime
identity and live ownership, with a30s deadline and1s HTTP request limits. Canonical
home normalization fixes `/var` versus `/private/var` alias receipts. Required
workspace build/types and staged Biome pass; CLI183 tests and updater/startup105
checks across six files pass. Mocked F1 desktop lifecycle, maintenance/drain9
scenarios and replacement/rollback10 scenarios pass. These use controlled agents
and do not prove physical provider continuation.

## Retained native failures

[Run38075672515](https://github.com/jappyjan/bobs-factory/actions/runs/38075672515)
(source6ed66581, digestc83766b26d667ca787c5cfb3d6701df07d634b663ecf09a2ed37af2afb9ede3a)
passes all four native package/manager steps but fails Electron: macOS adapter home
alias mismatch; Linux Xvfb screenshot capture UnknownVizError. The alias is fixed
in84f2. Virtual Linux now disables hardware acceleration; only the exact compositor
screenshot error can be recorded unavailable. Auth DOM, window, bridge, menu and
process errors continue to fail. Linux CI uses Xvfb and `--no-sandbox`; it does not
prove the production host's OS sandbox or physical credential devices.

[Run38076368125](https://github.com/jappyjan/bobs-factory/actions/runs/38076368125)
freezes84f2 (digest70cc6f6a5b3cfbc0fb0b9bb1463f0a8af7c3b5dc5b1156bcde143751fee578e4).
Its macARM menu exercise reaches maintenance rejection and successful shutdown;
the next assertion runs before the native Stop CLI releases the shared guard.
The fixture now waits for the success dialog before expecting stopped-intent
rejection. This is a fixture timing correction; guard exclusivity is retained.
Do not count the failed run as a four-target Electron pass.

## Acceptance mapping and remaining gates

| Ticket | Implemented and observed | Still required |
| --- | --- | --- |
| #121 desktop | Branded shared frontend shell; local attach/per-home worker lock; isolated origin sessions and limited launcher bridge; first passkey/onboarding UI; close/reopen same worker; explicit native Stop; DMG/AppImage/DEB preparation; shared runtime update settings/adapter. | Final corrected native menu receipts on both OS families, actual running-job window-close continuation, full prepared repository/provider onboarding, trusted DMG drag/open and package installation/removal/upgrade trials, remote HTTPS/native auth/client mismatch trials, physical credentials, minimum OS/libc proof, signing/publication and **full unattended Electron-shell/package updating**. Runtime/frontend replacement is not a complete app update. |
| #122 headless | Server-only CLI includes static frontend, no display/browser required; explicit service mode; protected host-local update control; per-home ownership; runtime replacement/rollback and mocked continuation; login/lingering/keychain boundaries documented. | Final signed integration source/installer policy/coexistence receipts, separate-host remote control and connection-loss trial, reboot/logout/lingering and physical native provider/auth continuation. |
| #124 lifecycle | Stopped opt-in install, startup enable/disable, actual manager PID/home/executable health, logs/start/Stop/restart/remove, crash backoff, retained removal, safe maintenance, orphan ownership recovery, suppressed intentional Stop and documented external handoff. | Independent corrected-source review, final native fixture receipts, actual login/logout/reboot/lingering, deliberately disabled PM2/manual/Nix migration on disposable hosts, preserved native provider continuation. Existing Mac PM2 ownership was never changed. |
| #119/#120 integration | Corrected updater sources merged; shared adapter authentic readiness, provenance, maintenance, external supervision and Stop suppression; mocked F1 retained. | Separate signed integration and independent outcome review, shell update capability and all retained public release gates. |

GitGuardian is **failed**, not bypassed: incident38083768/workspace140347,
occurrences303316965 and303317169, refers to the same synthetic capacity-lease
UUID in historical update-transport-drain/update-maintenance.json line21. The
check exposes no fingerprint. Operator review should be scoped to this exact
incident/occurrences; no blanket gate dismissal or history rewrite was performed.

Authentic reviewed publisher pins, protected signing, notarization, eligible
complete public channels, full-payload release/migration/license evidence and
exact-candidate publication approval remain #117 gates. No keys, agent credits,
production restarts, signing/publication, merges or ticket closure were performed.
