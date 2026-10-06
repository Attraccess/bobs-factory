# Visual evidence assistance and same-run recovery

Date: 2026-10-06. [PR #14](https://github.com/Attraccess/bobs-factory/pull/14).
Tested implementation: `063fefda`, based on
`91656030c9b3e8d32bc2b2d3202864e895425e8a`. Source/test/docs diff SHA-256:
`aa89503830464b9edf5ab7d99ba8f25c9305d0c129dbf5583283516512fa6783`.

## Failure and changed behavior

The reported run `manual-c013841a-64fe-4e9f-a279-74b0626106b9` failed at
`pipeline/visual-gate` after accepting six web screenshots. The two selected
Attractap states could not be captured because test-card authentication timed
out. Retry repeated the same gate with the same incomplete capture receipt.

Missing evidence now produces an assistance question and a durable waiting
checkpoint. An answer returns to the frozen graph's capture and visual-review
steps, retaining history and provenance-verified accepted images. Answers cannot
waive missing states; continued capture failures wait again. Legacy failed gates
open this checkpoint on Retry. Unsupported recovery paths and checkpoints inside
parallel branches fail safely. The gate artifact displays the capture blocker.

F1 applies to workflow/session recovery, native agent context, ticket activities
and the dashboard answer path.

## Isolated F1 drive

Fixture worker, repository, tracker state, receipts and logs are under
`node_modules/.cache/visual-capture-drive/`. Factory API: 3499; F1 RPC: 3616.
The real compiled EdgeWorker used CLI issue tracking, its Linear activity sink,
native Codex `gpt-6.1-sol` at low effort and real factory-context MCP.

The nested factory pipeline used a scripted two-state scope, a native capture
role with scoped inputs, the real visual gate, and deterministic scripted review
and delivery receipts. The capture agent copied supplied synthetic PNG assets;
this validates evidence lifecycle and reuse, not application screenshot quality
or Attractap authentication. No external ticket or PR was changed.

```sh
bun run node_modules/.cache/visual-capture-drive/worker.mjs
CYRUS_PORT=3616 apps/f1/f1 ping
CYRUS_PORT=3616 apps/f1/f1 create-issue --title 'Visual evidence assistance recovery' --description 'Validate missing Reader evidence waits for an answer and recovers in the same run while preserving accepted Web evidence.' --labels factory
CYRUS_PORT=3616 apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3616 apps/f1/f1 view-session --session-id session-1 --limit 5 --offset 14
```

- DEF-1/session-1 supplied Web evidence and reported unavailable Reader access.
  The gate became `waiting`, with a concrete question in the Factory UI and
  issue-tracker activity. No approval or delivery occurred.
- Graceful worker shutdown/restart preserved identical questions, history,
  frozen definitions, answers and graph position (`waiting-before.json` and
  `waiting-after.json`). Capture did not rerun before an answer.
- The T3 collaborative browser submitted “Reader access is ready” through the
  dashboard. The native capture agent read `/answers` despite scoped inputs,
  retained Web's exact image hash, and supplied Reader's missing receipt.
  `completed.json` verifies Web `reused:true`, Reader `reused:false`, empty
  unavailable states, approved visual gate, and fixture delivery. The history
  prefix and frozen definitions remained identical. Eighteen tracker activities
  included the assistance question, MCP/file actions and final response.
- DEF-2/session-2 exercised the updated artifact card/inspector after restart.
  DOM assertions verified “Capture assistance needed”, the actual access reason,
  and no “No findings” celebration in the blocked gate inspector.
- An answer reporting that Reader remained unavailable retried capture but
  returned to waiting. `repeated-blocker.json` verifies unapproved gate, no
  delivery, a second capture receipt, and retained accepted Web evidence.
- F1 stop-session passed for both fixture sessions; only the isolated worker
  was terminated. No unhandled worker errors occurred.

## Automated checks and limits

- The new recovery checks failed before implementation with `failed` rather
  than `waiting` and the original incomplete-evidence exception.
- Final edge-worker suite: 1,022 passed, one existing skip, across 94 files.
  Coverage includes frozen legacy Retry, wait/restart/answer recovery, scoped
  capture answers, verified image reuse, unreported selected-state gaps,
  repeated blockers, stopping, unsupported graphs and nested fanout safety.
- Monorepo build and typecheck passed; the final affected package build/types,
  changed-file Biome and `git diff --check` passed.
- A read-only replay of the original run returned `approved:false`,
  `captureBlocked:true`, its actual simulator authentication reason, and all
  six accepted web receipts.

T3 navigation, DOM inspection and form/artifact interaction succeeded. Snapshot
capture returned a preview-client error, so no pixel-level screenshot evidence
is claimed. The original failed run and deployed service were not mutated.
After loading the updated service, Retry opens capture assistance for that run;
the Attractap login/setup issue still needs to be resolved to supply its images.
