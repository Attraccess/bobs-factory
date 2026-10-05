# Factory output validation and compact evidence recovery

Date: 2026-10-05. Runtime: `51a1503de022ac6f1d5626595b12d9acf0c679dc`. Taskbot #62 / #63, [PR #6](https://github.com/Attraccess/bobs-factory/pull/6), stacked after #3–#5.

F1 applies to native role/session recovery, persisted output validation and agent context. The assertions are: reject a completed invalid guide, deliver exact correction feedback to the same native conversation, preserve accepted evidence, and resume a legacy checkpoint across worker restart without changing graph semantics or replaying capture.

## Setup

- Compiled EdgeWorker with real native Codex `gpt-6.1-sol`, low effort, CLI issue tracker and activity sink, real factory-context MCP.
- Fixture worker `/tmp/factory-output-recovery-worker.mjs`, repository `/tmp/factory-output-recovery-repo`, state `/tmp/factory-output-recovery-final-home`.
- F1 RPC port 3600; factory API port 3496.
- The repository has a changed `feature.ts` and unchanged `base-only.ts`. A deterministic Python helper prints a schema-valid guide with the deliberately invalid base-only chapter reference, or the corrected guide.
- A fixture script role supplies an accepted image and 16,000 dependency hashes. This is validator/session evidence, not an assessment of application visual quality. Native guides must read compact metadata and never recreate the image.
- The fixture persists the CLI tracker's maps/counters separately because the default tracker is in-memory. An earlier restart probe completed role recovery but lost tracker activity delivery; the final fixture repeats recovery with tracker persistence.

```sh
CYRUS_PORT=3600 ./apps/f1/f1 ping
CYRUS_PORT=3600 ./apps/f1/f1 create-issue --title 'Final fresh guide correction' --description 'Return invalid then correct without changing accepted evidence.' --labels guide-correction
CYRUS_PORT=3600 ./apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3600 ./apps/f1/f1 view-session --session-id session-1 --limit 3 --offset 0
```

## Fresh recovery

DEF-1/session-1 and DEF-2/session-2 completed. Each retained one capture history record and completed its guide in the same conversation after one automatic correction. Validation rejected `base-only.ts` with `/chapters/files`, expected `feature.ts`, and the actual extra file. Native factory-context calls read correction input and accepted screenshot metadata. No image or source changes occurred. CLI activity delivery showed 28 and 29 timestamped activities respectively, including tools and final responses; paged inspection succeeded.

## Legacy restart

DEF-3/session-3 was gracefully interrupted during correction with candidate, precise issues, attempts=1 and native conversation `01a10c10-aaac-7273-837b-67f56c4aea49` persisted. Its fixture snapshot's contractVersion was removed to emulate a legacy saved run. Startup resumes that checkpoint and records an explicit v2 migration at the execution boundary, preserving workflow definitions, graph position, native ID and accepted capture.

The final run completed at the same clean revision with exactly `[capture, guide]` history entries. Its accepted capture and frozen workflow definitions equal the pre-restart snapshot. The completed session snapshot retains native ID `01a10c10-aaac-7273-837b-67f56c4aea49`; guide coverage contains only `feature.ts`. The rejected candidate and attempt count survived two graceful interruptions, including a legacy contract migration. Factory trace includes resumed native tool/final-result events.

The restored CLI tracker retains its 29 earlier activities and supports paged inspection after restoring Date fields. New continuation activity is visible in the factory trace but was not delivered to the fixture's restored CLI tracker. This fixture limitation is not claimed as passing post-restart CLI activity delivery; fresh tracker delivery passed in the first two runs. No issue-tracker transport code was changed. The F1 worker was stopped after validation.

## Targeted verification

72 focused EdgeWorker/runtime/evidence/guide/server tests plus 4 context tests pass. Full build/typecheck and repository hooks pass. Coverage includes fresh and recovered malformed guides, omitted/extra files, transport failures, durable rejection and bounded correction, stable run definitions, recursive/shared source changes, tracked deletions, ignored build churn, explicit ignored runtime assets, symlinks/cycles/escape guards, compatible legacy evidence migration and complete context projection across history/corrections.

An actual billing candidate probe retains all 148 PR files and provides five precise base-only-file errors plus separate approval-delta input to the existing native guide ID. Actual capture projection retains all 24 paths/image hashes and reduces ~15 MB to 15,682 characters; the largest source dependency set falls from 15,845 to 1,808 entries. These probes do not modify production state.

## Production rollout

Runtime `51a1503d` was deployed to the existing service with backup manifest/artifacts, all runs and workflow configuration under `~/.cyrus/runtime-backups/20261005-output-recovery`. No production runs were active at deployment. All eight statuses, saved definitions, accepted outputs/history, human decisions and workspaces were preserved. All 24 billing screenshot files still match their accepted hashes.

While the service was stopped, the last native rejected guide from the diagnosis was imported as a completed candidate at the verified unchanged clean SHA, preserving its original native ID. It was not inserted as an accepted result. The normal recovered-result validator rejected it again, durably supplied the five exact issues and resumed native correction at `pipeline/guide`, attempts=1. `/retry` returned 202. Local and tailnet UI returned HTTP200, including 16.8/19.5 ms probes during correction.

Application PR #1928 head is `5f9153ddbc51c88f43e87d5ed7979a63105fa848`, base `e948f4123d8ca1c24acfbaee2af5c839382a7519`, matching stored evidence; all CI checks are successful or skipped. The prior human approval applies to `731caf1c`, not this head. No new approval or merge was issued.

Billing recovery completed at 12:45:36Z: `waiting / pipeline/human-review`, with a new pending gate for `5f9153dd`. The corrected guide has 9 feature chapters, the same requirements as the rejected candidate and exactly 148 net PR files. Only guide, handoff and human-review history were added. All prior history, definitions, decisions and all 24 capture paths/bytes/hashes remain identical. Native guide ID remains `01a10bcf-07b9-7601-8c58-603c82f6b541`. No capture, implementation, code review, CI or visual review was replayed.

Final semantic safeguards (`4a44eaa644561f4ccb1fa4557d3aaaec6a4113f9`) extend correction to capture budget/duplicate output failures, retain rejection counts through finalization, and checkpoint an in-progress finalization so IO retries revalidate the completed candidate without another native turn. Repeated semantic rejection is bounded at two corrections, including after a serialized checkpoint round trip. An additional native capture-budget fixture validates targeted removal of a third redundant image with the two original paths/bytes preserved.

The final `4a44eaa6` native capture-budget run (DEF-5/session-5) completed in conversation `01a10c1b-594b-79e3-9362-0437953dafb8`: expected 2 / actual 3 feedback was consumed, Paid/Free paths and bytes were retained, the redundant image was removed, and one v2 source manifest serves both images. Its tracker delivered 19 activities including the final JSON response; pagination returned that response.

Final runtime `4a44eaa6` was deployed after billing reached human review, with an additional backup under `~/.cyrus/runtime-backups/20261005-output-recovery-final`. Bootstrap was retried after the outgoing service finished shutting down. All eight checkpoints, histories, outputs, definitions, human decisions and review gates matched the pre-restart snapshots. Billing remains at the same pending gate, with no approval or merge. Local/tailnet checks returned HTTP200 in 14.1/19.7 ms.

Collaborative browser DOM verification shows “Ready for your review”, 0/9 chapters reviewed, 11 walkthrough steps (overview, nine chapters, checks/decision), and approval bound to `5f9153dd`. Screenshot automation failed on the preview client; DOM evaluation succeeded, so no screenshot evidence is claimed. Production guide/evidence was verified through state, hashes, HTTP and the live DOM. F1 workers were stopped; only the production service remains.
