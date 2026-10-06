# Taskbot uploaded-file workflow launch

Date: 2026-10-06. Tested `2d9226c3` plus the attachment fix and regression tests committed with this report.

Applicability: Factory ticket context loading and lifecycle synchronization changed; a relevant F1 drive is required.

## Reproduction and fix

Production run `manual-8f7b3b93-a139-4fc2-be55-14d3d49c2e6d` failed during preparation of Taskbot ticket #80 because its screenshot attachment had `kind: "file"`, `id: 100`, and `url: null`. The adapter required every attachment URL to be a string. The regression reproduced the exact `attachments/0/url` schema error before the fix.

Uploaded files now receive their download URL on the verified originating instance and project (`/api/<project>/files/<id>`). Their original filename, MIME type, size and other metadata remain available. External links retain their existing URLs; URL-less links and files without valid IDs still fail validation.

## Drive and results

The drive uses a fresh temporary home and local Git origin, the real EdgeWorker, FactoryServer, default factory workflow and nested pipeline, and a controlled HTTPS Taskbot MCP provider. Only the clarification agent result is simulated; it waits for a human response instead of implementing or publishing work.

```sh
CYRUS_DISABLE_REMOTE_SESSION_STORE=1 \
NODE_EXTRA_CA_CERTS=/Users/jappy/.cyrus/factory/evidence/taskbot-file-attachments-20261006/cert.pem \
node /Users/jappy/.cyrus/factory/evidence/taskbot-file-attachments-20261006/drive.mjs \
  /Users/jappy/code/jappyjan/bobs-factory \
  /Users/jappy/.cyrus/factory/evidence/taskbot-file-attachments-20261006
```

Exit 0; fixture run `manual-d60f5fa7-cf64-4ad1-a102-59316a4c9e5e`, 20 MCP calls, one clarification role.

- Default Factory URL launch creates a real worktree and reaches clarification.
- Full ticket body and normalized screenshot metadata reach the nested role and run API; original discussion remains intact.
- The normalized download URL returns HTTP 200 with `image/png`.
- Start and review milestones synchronize successfully with the uploaded file present.
- Repeated review synchronization attaches the PR once and preserves the provider's original file and external-link records.
- Stop finishes cleanly; runtime, HTTP server and HTTPS provider shut down.

Driver, call receipts and log are retained in the evidence directory above. No production tracker was mutated by the drive. File downloading in this fixture is unauthenticated; production Taskbot download access still requires its usual authentication. Native agent reasoning and real PR publication/merge are outside this scenario.

Relevant automated suites passed 82 tests, including the original failure and malformed-attachment guardrails. Worker build and changed-file Biome checks passed.

## Isolated merge validation

Before merging PR #24, its two commits were rebased onto `e5cd5b74` to keep the open PR #23 ticket-ownership work separate. The attachment implementation is unchanged. The same drive passed on `ced0f4be`: run `manual-8430ff23-fac3-4b03-b5ce-c9034c92ea5e`, one clarification role, 18 MCP calls. Receipts and logs are retained under `merge-validation/` in the evidence directory above. All 76 relevant tests present on this main base passed, along with the worker build, Biome and diff checks.
