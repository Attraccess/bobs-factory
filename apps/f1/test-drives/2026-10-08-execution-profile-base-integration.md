# Execution profiles and current-base integration

Date: 2026-10-08. Previous PR head: `ae3ce152697593125ef18d81ec855885e40504a4`.
Fetched and merged main: `58cce00b2ae6a4f2ab2c51f1fdfa8912ba466d6a`.

The merge keeps both execution-profile capabilities and the newer review-guide
requirements. Four conflicts were reconciled in the changelog, capability text,
complete routing-prompt expectation and capture-recovery fixture. No new UI
behavior was authored in this repair.

## Checks

- `pnpm build`, `pnpm typecheck`, `pnpm biome ci`, and `git diff --check` passed.
  Biome retained 19 existing warnings.
- Focused edge-worker tests: 252 passed in 12 files, including the complete
  routing prompt, guide correction, capture recovery, review state and execution
  environments. The Factory binary-launch environment variable was removed for
  source-based tests; all agent fixtures used `F1_AGENT_MODE=mock`.
- `env -u BOBS_FACTORY_INTERNAL_EXECUTABLE F1_AGENT_MODE=mock bun run node_modules/.cache/ci57-oct8.ts`
  passed with an actual compiled EdgeWorker, an isolated Factory home/repository,
  injected F1 simulated runners and headless Chromium.

## Integration assertions

A virtual passkey enrolled through the real operator setup routes. Changing the
workflow and reloading cleared unsent profile choices. An explicit launch
completed with the selected Bob/private profiles and the private canary
credential in the simulated runner environment. Both review-guide and execution
capability instructions reached that runner. Renaming the saved identity kept
the accepted run snapshot unchanged. Leaving Settings discarded unsaved edits;
a saved capacity limit survived reload. The 390px Settings capture was inspected
and retains all six sections, readable identity labels and reachable controls.

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-a51c4397-ff88-400d-ab07-b692f7f15df5`.
The receipt is `ci57-oct8-receipt.json`; the screenshot is
`ci57-oct8-settings.png`. Command logs are `/tmp/ci57-oct8-*.log`.
The owned browser and fixture servers stopped after the drive.

## Limits

No paid model calls ran. Simulated runners and a virtual passkey do not establish
live provider authentication or physical-device behavior. Earlier waived live
API-key/GitLab checks, unverified live Codex/App/hardware cases and the originating
ticket snapshot/runtime status discrepancy remain unchanged. This repair does
not submit human review decisions or merge the PR.
