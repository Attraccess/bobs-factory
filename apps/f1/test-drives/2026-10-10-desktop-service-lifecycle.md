# Desktop/service ownership and graceful recovery

Date: 2026-10-10. Source: 4324a9fe plus this PR's isolated changes.
No production worker or service was modified. No live agent/provider calls.

The change adds CLI instance ownership and desktop/user-service lifecycle. F1 is
applicable to ownership, graceful restart and workflow preservation. Native package
preparation uses separate integrity/build checks.

`F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/desktop-service-lifecycle.mjs`
passes with deterministic mocked role results and a scripted completion hook. The
fixture uses the real WorkflowRuntime, protected FactoryServer fixture sessions,
atomic CLI ownership and persisted home; it has no provider runner.

Assertions: concurrent ownership is rejected; client disconnect leaves a pending
human question unchanged; graceful shutdown and reattachment preserve the run ID,
mock native checkpoint, unanswered questions, frozen outputs and complete history;
preparation/clarification do not execute again; answering completes once; protected
run detail and activity records remain available. These are mocked native identities,
not real provider continuation evidence.

The CLI regression suite also kills only an isolated fixture worker, leaves a
marker-owned detached sleep child, and races two recovery starters. The old child
loses its execution ownership marker before exactly one replacement is admitted.
Maintenance persists across new manager instances; start/restart/enable cannot
undo it. External definitions are refused and removal retains definitions/state.

An actual macOS ARM64 Electron44.7.0 test against a locally compiled Bun1.4.2 dirty
runtime passed: CDP virtual authenticator enrollment/login/logout, first-launch
onboarding, no renderer require/native bridge, window close keeps worker alive,
reopen uses same PID and explicit Stop removes ownership. Run:

```sh
BOBS_FACTORY_DESKTOP_BINARY=/private/native-runtime/bobs-factory \
  pnpm --filter bobs-factory-desktop exec env -u ELECTRON_RUN_AS_NODE \
  electron test/native-smoke.mjs
```

Retained local fixture: `/var/folders/_r/fld8l71j7ts635hlb5vtgnb80000gn/T/factory-electron-smoke-ppmyaR`,
including onboarding.png. The first native pass caught a symlink/resolved-command
identity mismatch at Stop; correction passed the rerun. This is virtual-authenticator
evidence, not physical Touch ID/security-key or native credential portability.

Remaining release gates: four native installer/service targets, physical passkeys,
DMG drag/open, login/logout/reboot, service crash/backoff, real native continuation,
update success/failure/rollback on exact frozen artifacts, signing/notarization,
complete shell/runtime redistribution evidence and publication. The preparation
workflow is not a claim those gates passed.
