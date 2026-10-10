# Desktop lifecycle corrections — October 10, 2026

PR [#85](https://github.com/jappyjan/bobs-factory/pull/85) remains draft. Taskbot
#121/#122/#124 remain in progress. This report preserves the distinction between
implemented corrections, exact native observations and unfinished acceptance.

Production correction source is `84f2b98575357ebde3b094967ca0e1bfa72c5aa8`.
It includes updater outcome source `815c4515ef7bffa09c18ebe7bb31bf197bb55a2e`.
Upstream `09173e87` changes only native test-log sanitation; `16e60465` adds its
report/receipts. Later desktop test changes wait for the completed Stop dialog
before probing restart suppression. The final native fixture source is
`ed7bcaf6feb0fb8f39d9e0255b2fea0bfffeb1f1`. None changes production behavior after84f2.
The combined checkout is `/tmp/bobs-factory-lifecycle-integration`; the PR checkout
is `/tmp/bobs-factory-desktop-121`. Root and production services remain untouched.

## Four findings from independent review1069

| Finding | Correction and current proof |
| --- | --- |
| External generic symlink incorrectly replaceable | Installation permission is separate from update capability. Exact installer/desktop link layout, original regular operator-owned receipt and bound receipt hash authorize replacement. Constructor, maintenance admission, startup and link switch revalidate provenance/current durable identity. External executable services remain runnable without automatic updater enrollment. Real temporary filesystem regressions prove generic links rejected and changed receipts revoked. Separate signed integration validates the genuine shell-installer receipt. |
| Invalid quoted systemd WorkingDirectory | Serialize this directive as a raw absolute path with escaped specifiers; command/environment arguments retain their own quoting. Reject paths with unsafe line-ending semantics. [Run38074543720](https://github.com/jappyjan/bobs-factory/actions/runs/38074543720), source4c468a70, passes actual disposable systemd/launchd and packages on all four targets. Later6ed and84f2 manager steps also pass; their Electron-stage failures remain separate. |
| Linux Stop treats procps basename as a pathname | After UI confirmation the native CLI resolves `/proc/PID/exe` on Linux and the full process command on macOS, verifies start stamp and nonce, then signals only the desktop-owned worker. CLI regression uses an actual controlled child. Exact ed7 native Electron menu Stop passes on Linux ARM64/x64 and macOS ARM64/x64. |
| Stop dialog races maintenance and resurrects worker | Native final admission shares lifecycle-operation.lock with maintenance admission and startup. Fence/identity rechecks and durable Stop intent occur after confirmation, before graceful signal. Startup, crash restart and rollback startup honor suppression. Only explicit reopen outside maintenance clears it. Regression proves fence rejection, unchanged worker, stale nonce rejection, Stop/reopen intent and no rollback restart. Exact ed7 real-menu confirmation race and deliberate Stop suppression pass on all four native targets; retained84f2 fixture failure is described below. |

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

## Final four-target native matrix

[Run38076783115](https://github.com/jappyjan/bobs-factory/actions/runs/38076783115)
completed **PASS** on all four targets. Its exact source, runtime and tooling SHA
is `ed7bcaf6feb0fb8f39d9e0255b2fea0bfffeb1f1`, preparation version
`1.0.0-nightly.20261010.7`, candidate digest
`1c176a2d98cb18524a8f593eed73d335a747fa8b977ce4f4794e20a31084c791`.
Tooling uses Node24.18.0 and Bun1.4.2. Preparation is unsigned and not publication
eligibility evidence.

Small authentic artifact files are retained in
[assets/2026-10-10-desktop-ed7-native](assets/2026-10-10-desktop-ed7-native).
Each target has the original desktop-build identity/inventory, native service
receipt and raw Electron stdout. The adjacent Electron JSON is the final receipt
extracted from that stdout, which also contains the Electron download banner and
Linux D-Bus diagnostics. All four report `passed:true`; neither Linux receipt
has `screenshotUnavailable`. Large installers remain in the identified CI artifacts.

| Target / runner | Passing job | Retained artifact ID / ZIP SHA-256 |
| --- | --- | --- |
| darwin-arm64 / macos-15 | [114285359409](https://github.com/jappyjan/bobs-factory/actions/runs/38076783115/job/114285359409) | 11679201099 / `8fcb6afd7e47eb86d66abf1c66078c043823c4b27c95ac29c34fe5d0fd334d28` |
| darwin-x64 / macos-15-intel | [114285359602](https://github.com/jappyjan/bobs-factory/actions/runs/38076783115/job/114285359602) | 11679496894 / `58282baa09694463e4dd69e204a1343d0317be71c151e5dd9b9ef13d0c1760db` |
| linux-x64 / ubuntu-24.04 | [114285359405](https://github.com/jappyjan/bobs-factory/actions/runs/38076783115/job/114285359405) | 11679576318 / `a3d42ad1740138b7c278519c96bf4dedafa0c3f6f347a75da06a13a5b68d9bb7` |
| linux-arm64 / ubuntu-24.04-arm | [114285359421](https://github.com/jappyjan/bobs-factory/actions/runs/38076783115/job/114285359421) | 11679057083 / `2ad5d33ea106d50963479f44d0a320520243b8e1834277f7acef476bff6cfd8a` |

Each job builds matching runtime and DMG or AppImage/DEB, exercises actual
disposable launchd/systemd installation, enable/disable, PID/executable ownership,
crash restart, maintenance, Stop/restart and retained removal, then runs Electron
44.7 with virtual CTAP2 enrollment/login/logout. The shell exercise checks privileged
bridge isolation, close/reopen attachment to the same worker PID, a real menu Stop
confirmation held across actual update-maintenance admission, refused shutdown
during the fence, later successful explicit Stop, and adapter/crash/native update
supervisor suppression of deliberate Stop. Linux uses Xvfb and a test-only
`--no-sandbox`; physical passkeys, production OS sandbox, trusted installed-package
launch and minimum platform compatibility remain unproven.

The separate signed integration lane passes **23/23** on actual darwin-arm64
payload `aa0ad1404aed147cf82fc259cf0c11f6bb18753b`, evidence
`f4a2d8b4c61953d1295b5554469bb61e09176a19`, branch tip
`f8cf6bfab1807f9dbb3af01fc7542178ec32ea5a` (Taskbot116 comments1105/1109).
Its source includes production-equivalent updater corrections; later16e/091 are
test/evidence sanitation. Controlled signed discovery, HTTPS extraction, authentic
installer/settings handoff, package coexistence, runtime update/rollback/recovery
and bounded startup contention are proven there. It does not prove whole Electron
shell upgrading or official publisher trust/publication.

## Acceptance mapping and remaining gates

| Ticket | Implemented and observed | Still required |
| --- | --- | --- |
| #121 desktop | Branded shared frontend shell; local attach/per-home worker lock; isolated origin sessions and limited launcher bridge; first passkey/onboarding UI; close/reopen same worker; explicit native Stop; DMG/AppImage/DEB preparation; shared runtime update settings/adapter; all four native virtual-auth/menu/maintenance/suppression checks pass. | Actual running-job window-close continuation, full prepared repository/provider onboarding, trusted DMG drag/open and package installation/removal/upgrade trials, remote HTTPS/native auth/client mismatch trials, physical credentials, minimum OS/libc proof, signing/publication and **full unattended Electron-shell/package updating**. Runtime/frontend replacement is not a complete app update. Shell implementation is separately assigned from frozen ed7 (comment1114). |
| #122 headless | Server-only CLI includes static frontend, no display/browser required; explicit service mode; protected host-local update control; per-home ownership; runtime replacement/rollback and mocked continuation; login/lingering/keychain boundaries documented; controlled signed installer/policy/coexistence23/23 accepted. | Separate-host remote control and connection-loss trial, reboot/logout/lingering and physical native provider/auth continuation. |
| #124 lifecycle | Stopped opt-in install, startup enable/disable, actual manager PID/home/executable health, logs/start/Stop/restart/remove, crash backoff, retained removal, safe maintenance, orphan ownership recovery, suppressed intentional Stop and documented external handoff; four-target actual manager and Electron Stop checks pass. | Independent corrected-source review, actual login/logout/reboot/lingering, deliberately disabled PM2/manual/Nix migration on disposable hosts, preserved native provider continuation. Existing Mac PM2 ownership was never changed. |
| #119/#120 integration | Corrected updater sources merged; shared adapter authentic readiness, provenance, maintenance, external supervision and Stop suppression; mocked F1 retained; controlled signed runtime integration23/23 accepted. | Independent outcome review, separately assigned shell update capability and all retained public release gates. |

GitGuardian is **failed**, not bypassed: exact ed7 check114285305556 finds four
occurrences across two synthetic capacity-lease UUID incidents in workspace140347.
Incident38083768, occurrences303316965 (46ec) and303317169 (0dac), points to
historical update-transport-drain/update-maintenance.json line21.
Incident38084076, occurrences303319068 (662f) and303319323 (6ed), points to
update-startup-contention/update-maintenance.json line21. Both fields are controlled
mocked-F1 capacity lease tokens, not provider/publisher credentials. The check
exposes no fingerprint. Durable operator review should be scoped to both exact
incidents/occurrences; no blanket gate dismissal or history rewrite was performed.

Authentic reviewed publisher pins, protected signing, notarization, eligible
complete public channels, full-payload release/migration/license evidence and
exact-candidate publication approval remain #117 gates. No keys, agent credits,
production restarts, signing/publication, merges or ticket closure were performed.
