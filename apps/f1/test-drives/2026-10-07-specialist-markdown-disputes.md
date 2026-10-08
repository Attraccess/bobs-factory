# Resolved specialist disputes in review guide Markdown

Date: 2026-10-07. Tested PR [#32](https://github.com/Attraccess/bobs-factory/pull/32)
base `d6963da898c9d03c2e80f312b9f3172e00b02c5c` plus the QA-001 correction.

F1 applies to review guide evidence export. Before correction, replaying the
recorded finalized guide through `reviewGuideMarkdown` omitted the disagreement,
resolution rationale and supporting evidence. Both chapter and legacy guide
regression tests reproduced that failure, then passed after correction.

The fresh drive reused the recorded QA worker's `MODE:coverage` scenario in an
isolated home and repository, on dashboard/RPC ports 3913/3914. It used
`F1_AGENT_MODE=mock`, injected deterministic agent attempts, the compiled
EdgeWorker, real CLI tracker/RPC, configured specialist fanout and production
output finalization. External provider boundaries were fixtures. This does not
claim live model behavior, remote CI, publication or merge verification.

## Results

- DEF-1/session-1 extracted R1/R2 and completed six configured reviewers. R1 was
  met; R2 was explicitly skipped by Alice. The guide finalized and waited at
  `child/human-review`, with no human approval submitted.
- Retested failed criterion `human-markdown-evidence`: the generated Markdown
  contains the attributed business disagreement, resolution rationale and
  supporting evidence, every assessment's criterion/reason/evidence, and the
  correct fixture revision `68bada2e458ca9d2838f39971a2ac755132e6ef1`.
- A fresh named headless browser opened the guide, expanded coverage and the
  requirements reviewer, and displayed the same resolved dispute. The screenshot
  was inspected. No approval or feedback was submitted.
- All 28 focused guide/specialist tests, build, typecheck, affected-file Biome
  checks and whitespace checks passed. Legacy receipts without dispute
  resolutions remain supported; unresolved disagreements remain exported.
- The browser session, F1 session and isolated worker were stopped. Historical
  evidence was preserved. Existing SR-001/SR-002/SR-003 dispositions are unchanged.

## Reproduction and evidence

```sh
pnpm --filter cyrus-edge-worker test:run test/Guide.test.ts test/SpecialistReview.test.ts
pnpm build
pnpm typecheck
F1_AGENT_MODE=mock bun <evidence>/qa-fix/worker.mjs
CYRUS_PORT=3914 apps/f1/f1 ping
CYRUS_PORT=3914 apps/f1/f1 create-issue --title 'Resolved dispute Markdown evidence' --description 'MODE:coverage Reject blank input and preserve resolved specialist dispute evidence in Markdown.' --labels workflow:qa73
CYRUS_PORT=3914 apps/f1/f1 start-session --issue-id issue-1
agent-browser --headed false --session qa001-fix73 open http://127.0.0.1:3913/
CYRUS_PORT=3914 apps/f1/f1 stop-session --session-id session-1
```

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-0b7cf77f-8296-4e61-9df5-b03561e59729/qa-fix`.
It retains `worker.mjs`, isolated paths/logs, `guide-api.json`,
`guide-session-1.md`, `criterion-retest.json`, `browser-guide.txt`,
`guide-dispute.png` and cleanup receipts. Supplied ticket-sync receipts are
delivered; no tracker mutation was made by this role.
