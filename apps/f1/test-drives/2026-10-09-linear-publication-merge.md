# Linear publication after merging main — Taskbot #101

The tested merge combines PR #73 head `59ab49496a87b4caf834173f630616927769a8f7` with main `be36eb345ab5b182ff3a1ffcba2f27fa7e2ef599`. This report and the fixture fixes are committed with the merge.

Conflicts in the changelog and workflow capability text were resolved by retaining both branches: Linear publication behavior and the current handoff guide-recovery instructions. Recovery mocks now expose the message-tagging method; the decision fixture expects native completion responses under the accepted lifecycle exception.

## Validation

- `pnpm build` and `pnpm typecheck` passed.
- All 343 selected tests passed: core presenter (8), Linear transport (62), and edge-worker publication, sink, tracking, decision documentation, pipeline, workflow runtime and capture recovery (273). The initial run exposed stale fixtures; all 39 tests in those two files passed after correction.
- Biome passed on the resolved TypeScript and fixture changes. `git diff origin/main --check` passed. Main contains existing Markdown hard-break whitespace in its TUI report; that report was preserved.
- `F1_AGENT_MODE=mock pnpm --filter bobs-factory-core exec tsx "$PWD/apps/f1/test-drives/assets/linear-publication-101.ts"` passed using simulated agents and an isolated loopback provider. It verified one explicit decision comment, ten native lifecycle comments, zero routine progress comments, one completion response, all four modeled provider states, auth/select signals, nested/parallel outcomes and zero restart duplicates or unhandled rejections.

Logs: `/tmp/ci-fix-73-build.log`, `/tmp/ci-fix-73-typecheck.log`, `/tmp/ci-fix-73-tests.log`, `/tmp/ci-fix-73-retest.log`, `/tmp/ci-fix-73-f1.log`.

Actual Linear rendering remains untested as requested. Historical evidence, including the previously reported Bun recovery-fixture limitation, is retained. No live agents or provider credits were used.
