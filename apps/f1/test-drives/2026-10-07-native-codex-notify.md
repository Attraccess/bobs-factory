# Native Codex Share notification admission

**Date:** 2026-10-07  
**Revision:** fixer delta on `3d9bf254f570655c54e2b34cfa34e12d346ffc05`  
**Finding:** R57-NATIVE-NOTIFY  
**Ticket:** [Taskbot #57](https://taskbot.apps.janjaap.de/p/bobs-factory/t/57)  
**Draft PR:** [#30](https://github.com/Attraccess/bobs-factory/pull/30)

F1 applies to this authentication/admission delta. The scoped drive uses the built
EdgeWorker, effective preview and manual launch APIs, the real bundled Codex
0.159.2 app-server configuration reader, and a fresh local Git repository. The
fixture supplies only a controlled `account/read` response, enabling the
configuration-policy check without a live subscription account or model turn.
No thread or turn request is permitted by the fixture. It runs on isolated ports
3731/3732 with fresh state under `node_modules/.cache/notify57-5ojaH8`.

## Results

- A native configuration containing a notification command rejects with HTTP 409
  at both preview and manual admission. The diagnostic names notification commands
  without exposing the command path.
- Rejection leaves run count unchanged, executes no setup hook, and preserves the
  selected configuration file.
- Changing the fixture configuration to `notify = []` permits preview, manual
  admission and completion of one scoped script workflow. Setup runs exactly once.
- Real Codex configuration reads observe both nonempty and empty notification
  lists. The notification marker is absent; no command executes.
- The isolated worker stops cleanly. Existing host credentials/configuration and
  prior evidence are untouched.

The inspector regression test first reproduced acceptance of both a nonempty
notification command and an unexpected notification value shape. All **11**
inspection tests then passed after the fix, including the empty-list case.
Native Share and complete routing-prompt suites passed **9** tests. The complete
prompt expectation now documents rejection of Codex notification commands.

## Commands and evidence

- `pnpm --filter cyrus-codex-runner test:run test/inspectNativeLogin.test.ts`
- `pnpm --filter cyrus-edge-worker test:run test/NativeExecutionShare.test.ts test/prompt-assembly.routing-context.test.ts`
- `pnpm --filter cyrus-codex-runner build`
- `pnpm --filter cyrus-edge-worker build`
- `node /Users/jappy/.cyrus/factory/evidence/manual-a51c4397-ff88-400d-ab07-b692f7f15df5/notify-drive.mjs`

The fixture source, `notify-drive.json` receipt and `notify-drive.log` remain in
that evidence directory. Required commit checks run full build and typecheck;
changed-file Biome and full lint checks also pass. Lint retains the existing
28 warnings. No dependencies or frontend components changed.

## Limitations

The account response is controlled; this drive does not establish successful live
Codex subscription authentication or execute a model turn. Live runner/GitLab
checks remain waived by the accepted answer. Successful live Codex subscription
admission and GitHub App authorization remain unverified. The documented ticket
snapshot/status discrepancy remains a synchronization limitation. Historical
[review-fix evidence](2026-10-07-execution-profile-review-fixes.md) is preserved.
