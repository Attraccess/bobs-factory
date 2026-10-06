# Ticket tracking after the guided-review merge

Date: 2026-10-06

Candidate: PR #19 at `25eab2e5` merged with `main` at `c4322e5f`.
Resolved adjacent changelog and documentation conflicts by retaining both
ticket tracking and guided review content. Runtime changes merged automatically.

Rebuilt the workspace and ran the existing isolated ticket lifecycle drive:

```sh
NODE_EXTRA_CA_CERTS="$EVIDENCE/ticket-f1-guided-merge/cert.pem" \
  node "$EVIDENCE/ticket-f1-guided-merge/drive.mjs" \
  "$EVIDENCE/ticket-f1-guided-merge"
```

`EVIDENCE` denotes
`/Users/jappy/.cyrus/factory/evidence/manual-df3a6623-c843-44af-8926-fdc200996962`.
The drive uses rebuilt EdgeWorker, WorkflowRuntime, configured HTTPS MCP and
CLIIssueTrackerService with isolated repositories and tracker state. All twelve
assertions passed: complete Taskbot context, start/review/rejection milestones,
PR links, merge-only completion, pending merge recovery across restart, nested
and follow-up identity, native base selection and response-loss recovery,
legacy tracking-only retry, and accepted Cursor MCP discovery. Agent and GitHub
responses are simulated; production tickets and PRs are untouched by the drive.

Ran the isolated pending-synchronization browser fixture against the merged web
build. Chromium at 1440×900 shows the readable provider warning, complete
recovery guidance, and Open run/Stop controls in the expanded Today row.
Screenshot: `ci-guided-merge-ticket-sync-pending.png` in the evidence directory.
This is an integration smoke check; it does not replace the pipeline's visual
review of selected states. Stopped the fixture after inspection.

Verification: workspace build and typecheck passed; all 202 tests in twelve
focused EdgeWorker suites passed, covering lifecycle, tracking, launch inputs,
guide validation and recovery, review files/model/state, server and PWA assets.
Biome checked all twenty changed code files without changes; diff checks passed.
Logs use the `ci-guided-merge-` prefix. F1 results are stored separately in
`ticket-f1-guided-merge/results.json`; historical evidence remains unchanged.
