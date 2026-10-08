# Specialist review with provider-neutral PR tooling and Web Push

Date: 2026-10-08. PR: [#32](https://github.com/Attraccess/bobs-factory/pull/32).
Tested local head `46c9186cf466574d64db7359901e355475fe7716` with the pending
merge of `236afd2a1018b940f4b88ac7b02acddf7e6ea626` and conflict resolutions.

## Merge behavior

Retained specialist requirement coverage and concurrent runner cleanup safeguards
alongside provider-neutral publication/readiness and Web Push from main. Combined
capability descriptions and complete routing-prompt expectations. The GitLab
publication fixture now distinguishes head and base revisions and asserts the
base revision returned for specialist review.

## Simulated-agent F1

Commands from the repository root:

```sh
F1_AGENT_MODE=mock env -u BOBS_FACTORY_INTERNAL_EXECUTABLE node \
  /Users/jappy/.cyrus/factory/evidence/manual-0b7cf77f-8296-4e61-9df5-b03561e59729/ci-r13/integration.mjs
F1_AGENT_MODE=mock env -u BOBS_FACTORY_INTERNAL_EXECUTABLE node \
  /Users/jappy/.cyrus/factory/evidence/manual-0b7cf77f-8296-4e61-9df5-b03561e59729/ci-r13/mixed-f1.mjs
```

The compiled production EdgeWorker uses isolated temporary repositories, Factory
homes and capacity pools. Agents are injected simulations. F1 creates issues,
starts sessions and reads their activity streams through its CLI.

Passed assertions:

- Malformed requirement extraction is corrected; recommendations remain pending
  until explicit fixture submission. All six specialists share the frozen
  revision and authoritative R1 inventory. Execution output remains redacted.
- Guide-only correction supplies the required system map. Finalized guides and
  Markdown retain requirement coverage and attributed resolved disagreements.
- Production Cursor artifact setup remains concurrent with another reviewer.
  Clean review succeeds after cleanup. Remaining tracked, untracked and Cursor
  directory edits, and a changed commit, prevent aggregate approval.

## Headless browser

The integration fixture drives a fresh headless agent-browser session using a
virtual passkey. Protected API access rejects unauthenticated requests. Nine
browser assertions passed: system map rendering, item comments on Decide,
coverage and disagreement evidence, narrow coverage without page overflow,
capacity settings save, editable specialist contract, exact trigger focus after
Escape, navigation clearing unsent feedback, and no approval or browser errors.

Inspected screenshots:

- [Desktop coverage with Notifications header](media/2026-10-08-specialist-provider-push-integration/coverage-desktop.png)
- [Mobile specialist settings](media/2026-10-08-specialist-provider-push-integration/specialist-settings-mobile.png)

## Targeted checks and limits

488 focused tests passed across 19 suites after updating the GitLab fixture's
expected base revision. Edge-worker dependency build, typecheck, whitespace and
Biome CI passed; Biome reports 19 existing warnings. Frozen-lockfile install
passed and pnpm audit reported no known vulnerabilities.

Scripts, complete results, commands, browser receipts and cleanup receipts are
under the ci-r13 evidence directory above. Workers and named browsers stopped.
Provider publication/readiness is tested with mocked commands; no live GitLab
or Web Push delivery is established. Real-agent judgment and physical passkeys
remain unverified. Historical tracking/recovery limitations remain recorded.
No approval, PR readiness change or merge was performed by this fixture.
