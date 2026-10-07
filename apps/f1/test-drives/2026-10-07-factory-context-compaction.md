# Factory context compaction

Date: 2026-10-07. Tested runtime changes committed in `d740929a`, based on
`9badbae6`. Driver: `/tmp/bobs-context-compaction-drive.mjs`.
Final evidence: `/tmp/bobs-context-compaction-f1-cc7Dlo`.

## Applicability and expected behavior

F1 applies because the changed MCP input protocol is used by Factory agent roles.
A CLI-platform EdgeWorker ran against a fresh local Git repository and local bare
remote, isolated home/worktrees, one-slot capacity pool, RPC port 3600 and protected
Factory API port 3540. Every provider used `MockAgentRunner`; each scripted role
connected to its actual private `factory-context` stdio server with an MCP client.
The API used an isolated server-side fixture session. No native agent CLI,
inference API, provider credits or production service was used.

The assertions required compact history discovery, exact original source access,
retention of disputed/reopened findings and accepted decisions, restart recovery,
input isolation, visible tool activity, snapshot cleanup and released capacity.

## Drive and results

```sh
F1_AGENT_MODE=mock bun run /tmp/bobs-context-compaction-drive.mjs
```

Both scenarios entered through `apps/f1/f1 create-issue` and `start-session`:

- **Repeated review and restart:** seeded 92 historical review/capture outputs
  plus their accepted gate outcome. Each role browsed history in 50-entry pages,
  read compact review memory, recovered exact original output and full-record
  references, checked the revision delta and retained the accepted decisions.
  The fixer requested fixture access. The worker stopped and was recreated with
  the same home and persistent fixture tracker; it remained waiting until an API
  answer arrived. The next fix rejected the complaint. A fresh review retained
  that rejection, supplied new failure evidence and an additional boundary
  finding, and required another correction. A committed fixture correction then
  passed fresh review. The run completed with 103 full history records, one
  answer, three reviews and three fixer visits. The last reviewer verified both
  the earlier rejection and the new evidence in compact memory.
- **Restricted inputs:** a fixer with `inputs: ["plan"]` could read its declared
  plan and runtime-owned current finding. `/history` and `/outputs/ticket` were
  rejected in both compact and full views. No review memory was synthesized from
  undisclosed history. The run completed after one fixer visit.

`receipts.json`, `repeat-run.json` and `scoped-run.json` retain the results. The
scripted repeat roles needed 9–10 MCP calls per visit, including source recovery
and assertions; history discovery took two or three paginated calls, never one
read per step. Fifty-six structured tool-use activities and corresponding
results were observed. Result costs were zero. All private role snapshots were
removed after completion. The final capacity pool had zero active/queued
requests; shutdown released both test ports.

## Measured context reduction

A read-only reconstruction of the migration run's 92-entry input used its saved
history, current inputs and ten recent history records. It was not relaunched or
modified. `/tmp/bobs-context-compaction-production-measurement.json` records:

| Measure | Original | Compact |
| --- | ---: | ---: |
| Context characters | 1,356,517 | 415,283 |
| History characters | 847,068 | 13,298 |
| History role-discovery calls | 92 individual reads | 2 listings |
| Review claims | 121 occurrences | 83 distinct exact claims |

All distinct review claims plus chronological summaries/gate outcomes fit in six
16,000-character read pages. Current outputs, requirements, decisions and answers
remain exact; the original private snapshot and persisted history are unchanged.
These are data/interface measurements, not a live-model token or latency benchmark.

## Other checks and limitations

- All 1,442 EdgeWorker tests passed (one skipped), plus all 45 MCP tests.
  Monorepo `pnpm build` and `pnpm typecheck`, Biome on changed TypeScript files
  and `git diff --check` passed.
- MCP tests exercise oversized Unicode pagination, exact full-history recovery,
  immutable snapshots, distinct and identical reopened claims, rejected fixes,
  observations, independent scopes, legacy unlabelled findings and role discovery.
- The original full EdgeWorker run exposed a legacy-prompt fixture that derived
  its supposedly old reviewer from the new template. It now uses the frozen
  historical reviewer; production upgrade signatures remain unchanged.
- The initial drive assumed every activity body could be parsed as JSON. Existing
  activity logging bounds long bodies to 20,000 characters. The driver was
  corrected to inspect complete structured activities; source recovery assertions
  independently checked untruncated MCP results. Final evidence comes from the
  fresh successful drive above.
- This validates scripted orchestration and the real MCP transport. It does not
  establish native model browsing choices, provider transcript compaction, live
  ticket synchronization or production deployment. Review limits and human
  approval requirements are unchanged.
