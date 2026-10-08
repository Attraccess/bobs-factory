# Specialist review integration with main recovery changes

Date: 2026-10-07. Tested the merge working tree of `bd409263` and main
`b317ea9e` for [PR #32](https://github.com/Attraccess/bobs-factory/pull/32).
The changelog conflict retains both branches' entries. The test conflict retains
both specialist inventory correction and saved-fixer question guidance tests.
Historical review and F1 evidence is preserved.

## Applicability and setup

F1 applies to the merged changes in Factory feedback recovery and generated
runner instructions. Targeted drives exercise those paths with real EdgeWorker,
workflow runtime, F1 tracker/RPC and dashboard API, isolated repositories and
homes, and deterministic mocked agents. Provider readiness and comment reads
are scripted; unexpected provider mutations fail. No native agent or paid
inference runs, production changes, PR approval or merge occur.

Evidence and adapted drivers are retained in
`/Users/jappy/.cyrus/factory/evidence/manual-0b7cf77f-8296-4e61-9df5-b03561e59729/ci-r4/`.
`merged-working-tree.patch` records the tested merge before this report.

```sh
F1_AGENT_MODE=mock bun EVIDENCE_DIR/legacy-feedback.ts
F1_AGENT_MODE=mock CYRUS_DISABLE_REMOTE_SESSION_STORE=1 node EVIDENCE_DIR/human-language.mjs
```

The drivers replace the previous fixtures' source paths with this worktree and
use unused loopback ports: recovery RPC/UI 3954/3953, language RPC/UI 3952/3951.
They invoke F1 `ping`, `create-issue`, `start-session` and `view-session`; the
language drive also invokes `prompt-session`.

## Results

- Both legacy receipt cases passed. A CI fixer with restricted recipe inputs
  received the exact outstanding comment ID, body and content hash. Restart
  preserved the assistance wait without launching another role. An explicit
  fixture answer resumed the same fixer. The exact assessment was persisted,
  each case ran code review once, and required human actions remained blocking.
  Receipts: `legacy-8mxTlA/receipts.json`, `contexts.json`, `legacy.json`,
  `restart.json` and `legacy-checkpoint.json`. Final capacity had zero active or
  queued requests; both worker instances stopped cleanly.
- The saved-fixer language case passed. All three mocked executions received
  the complete shared communication and question instructions with the original
  custom prompt and `askQuestions: false`. Full question text reached the API
  and tracker activity. An explanation-only reply left the run waiting; an
  explicit fixture decision completed its receipt step. Receipts:
  `language-BWaItG/receipts.json`. The worker stopped cleanly.
- 184 focused tests passed across seven suites covering recovery, full runner
  prompt assembly, specialist coverage, feedback policy, questions, readiness
  and workflow runtime. The initial two-suite invocation separately passed 26
  tests. Root build, Biome CI (29 existing warnings) and whitespace checks passed.

The frontend build ID remained `d06b07332fcc991011b681e9`; no frontend code changed.
Prior exact-trigger focus evidence and SR-001 through SR-004/QA-001/QA-002
dispositions remain intact. These drives establish instruction delivery,
context reconstruction and workflow behavior with simulated agents. They do
not establish real-model readability or live-provider continuation. Historical
capacity-lock and iteration-limit incidents remain recorded limitations.
