# Refinement merge validation for Bob’s Factory

Date: 2026-10-07. Tested PR #34 head `331556d22e22dc389f0354c9658576929256b487`
with base `b9974c8b121468e2075d82fd70a3ffa75d5cb757` merged and the fixture
configuration fixes applied. Dashboard build: `c0369eb4b5fa72bae32f7317`.

The base adds refinement recommendations and restart-safe question drafts. F1
applies to the merged question lifecycle and dashboard. Changelog conflicts retain
both changes. The executable fixture uses the renamed packages, environment and
`factoryHome`, including a fresh isolated migration-source coordinator directory.
Historical PR #31 reports remain unchanged.

## Checks and results

- `pnpm build`, `pnpm typecheck`, `pnpm biome ci`, and `git diff --check` passed.
  Biome reported 18 existing warnings.
- Seven affected EdgeWorker suites passed 187 tests: Questions, WorkflowRuntime,
  FactoryServer, FactoryPipeline, FactoryPwa, capture recovery and routing prompts.
- `F1_AGENT_MODE=mock F1_EVIDENCE_DIR=<evidence>/ci-refinement-merge bun
  apps/f1/test-drives/assets/refinement-recommendations-mock.mjs` passed. The CLI
  issue tracker routed two isolated issues through the real worker and worktrees.
  Dashboard defaults accepted no answers until explicit Send answers; dashboard
  submission and an existing-session ticket reply each resumed exactly one mocked
  agent turn and one receipt script. Both completed with the expected answers.
- `F1_AGENT_MODE=mock F1_EVIDENCE_DIR=<evidence>/ci-refinement-merge bun
  apps/f1/test-drives/assets/qa-question-restart.mjs` passed. Unchanged restarts
  preserved question batch identity; changed recommendations and later rounds
  rejected stale submissions and waited for explicit answers.
- The headless browser screenshot `ci-refinement-merge/qa83-mock-defaults.png`
  was opened and inspected: both recommendation answers and reasons are readable,
  defaults are selected, and the explicit Send answers control is visible.

The first refinement fixture attempt stopped at the legacy-capacity startup
barrier when it inspected the host coordinator. The fixture now selects its own
fresh migration-source directory; host policy and active executions were not changed.
Worker shutdown and browser-session cleanup succeeded after the passing run.

## Evidence and limitations

Raw receipts and the screenshot are under
`/Users/jappy/.cyrus/factory/evidence/manual-7f0c7c6e-cca1-4387-b7ee-7d81e06997ba/ci-refinement-merge/`.
Agents and background titles use explicit injected mocks. These checks establish
orchestration, rendering and answer retention, not native provider behavior or
real remote ticket delivery. Prior release-validation waivers, the limited audit
exception and unverified live Taskbot state remain unchanged. PR remains draft.
