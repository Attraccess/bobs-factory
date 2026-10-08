# Native specialists and complete requirement coverage

Date: 2026-10-07. Tested base `45143ca38bdda80ae57321ae1556311de79c1b89` plus the uncommitted Taskbot #73 implementation. Served UI build: `26750b79d2408301b0332763`.

## Applicability and fixtures

F1 applies to the changed factory execution, persisted fanout, correction loops, QA references, and guide presentation. Both fixtures use a compiled EdgeWorker, the real CLI tracker/RPC, isolated repository worktrees, factory runtime, and dashboard API. No production ticket was mutated by the drive. The runtime owns the originating Taskbot ticket's lifecycle and synchronization.

The native drive uses Codex agents for extraction, all six configured specialist branches, QA planning/execution/review, and guide generation. Preparation commits a small string validator and actual Node assertions. Only external PR/provider boundaries are fixtures; no PR publication, approval or merge is exercised. The workflow stops at human review.

Native home: `/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/native73-home-fTHPqU`. Repository: `/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/native73-repo-hlcoRu`. UI/RPC ports: 3873/3874. Capacity uses an isolated home pool. Six branches were observed with four executing and two queued, then released slots as they completed.

The controlled drive uses the production agent finalization/output-correction path with deterministic provider responses. Its parent calls a nested pipeline. It explicitly replaces the stock coverage reviewer and adds an optional performance reviewer, for seven configured branches. This isolates consequential error, fix, and restoration assertions without claiming extra native inference coverage.

Controlled home: `/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/controlled73-home-7WwiqX`. Repository: `/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/controlled73-repo-l83rf6`. UI/RPC ports: 3875/3876.

Evidence and reproducible fixture scripts are retained in `/Users/jappy/.cyrus/factory/evidence/manual-0b7cf77f-8296-4e61-9df5-b03561e59729`.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
node <evidence-directory>/native73.mjs
CYRUS_PORT=3874 apps/f1/f1 create-issue --title 'Implement Nonempty String Validator' --description '<validator criteria, trimmed return refinement and Alice local-only decision>' --labels workflow:review73
CYRUS_PORT=3874 apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3874 apps/f1/f1 view-session --session-id session-1 --limit 12
node <evidence-directory>/controlled73.mjs
python3 <evidence-directory>/check-controlled73.py
agent-browser --headed false --session specialist73 open http://127.0.0.1:3873/
```

## Results

- Native DEF-1/session-1 extracted complete paginated ticket context. Six independent specialist receipts approved nine active requirements. Their unique execution paths share inventory version 1, its digest, clean head `66d35f7e62705502836143f929f52c9b29b91e91`, and base `78304b316748dec36ec70f110616c8bc4881aaec`. No consequential findings or disagreements were open.
- Native QA planned four executable stories, thirteen criteria and one justified exclusion. Real local Node commands checked accepted trimmed values and invalid-input TypeErrors. The specialist coverage audit used all active stable requirement IDs. Capture and the deterministic visual gate approved without visual screenshots because this fixture is an API/CLI change.
- The guide's first native response did not exactly match the active inventory. Production validation rejected it and entered guide-only correction. The corrected guide includes all nine active criteria and six specialist summaries, with runtime-attached coverage. The run reached the human-review gate without any approval.
- Controlled session-1 started with an unmet blank-input criterion. A real corrective commit changed the SHA; extraction ran again, added a refinement, and retained Alice's explicit telemetry skip. The second aggregate approved, recorded the old finding as resolved, and assessed both active IDs. Seven configured reviewer receipts came from the replacement/optional roles; the removed stock coverage reviewer did not execute.
- Controlled session-2 supplied duplicate coverage IDs. Two correction attempts exhausted the budget, persisted the rejection evidence, and failed before aggregation. Session-3's required reviewer failed; successful siblings could not produce an approval.
- Removing the sole configured coverage supplier through `PUT /api/workflows` returned 409 with an actionable replacement instruction. Saved definitions remained unchanged.
- Graceful controlled-worker restart restored the nested `child/human-review` checkpoint. History, outputs, checkpoint and both review rounds were identical, with no completed branch replay.
- The first controlled attempt exposed uncommitted harness configuration in the fixture. The clean-worktree guard correctly blocked review; the fixture was committed before retry. This was fixture preparation, not a product bypass.

## Checks and limits

The full edge-worker suite passed 111 files: 1,337 tests passed and one skipped. The final affected-file run passed 152 tests in six files after the guard, migration and retained-dispute changes. A focused check also proves authoritative accepted-skip guide data, multi-round removed-role dispute retention and retained observations. Root build/typecheck, final edge-worker build, root lint and whitespace checks are also retained. Root lint reports 29 existing warnings and no errors. Dependency manifests and lockfile are unchanged.

Recipes screenshots at 1440×1100 and 393×852 were captured and visually inspected. They show all specialist settings and the selected role's prompt, model/provider settings, output contract and structured-JSON requirement. Browser work used a fresh named headless Chromium session. Physical-device behavior and real remote CI/provider publication are outside this drive.

Final native and controlled workers were restarted on the final compiled implementation. Both waiting runs retained identical accepted workflow definitions, checkpoints, history, outputs and review rounds. The replacement/removal/failure assertions passed again. Current native and controlled aggregate evidence also passes the final production revision validator.

Headless guide checks at 1440×1100 and 393×852 found exactly R1–R8 and R10, all six specialist sections, and no horizontal document overflow. Recipe UI checks rejected an invalid structured-JSON setting with visible inline feedback and no configuration mutation. A valid model edit changed only `/3/steps/7/groups/0/0/model`; the original fixture configuration was restored. No human approval was submitted.

Final screenshots were visually inspected: [desktop coverage](/Users/jappy/.cyrus/factory/evidence/manual-0b7cf77f-8296-4e61-9df5-b03561e59729/guide-coverage-desktop-detail.png) and [mobile coverage](/Users/jappy/.cyrus/factory/evidence/manual-0b7cf77f-8296-4e61-9df5-b03561e59729/guide-coverage-mobile-detail.png). Full-page captures and recipe desktop/mobile captures are retained alongside `browser-final-checks.json`, `recipes-browser-checks.json`, `final-restart-checks.json`, `controlled73-checks.json` and native compact receipts. The guide screenshots cover native all-met coverage; accepted-skip guide data is verified by targeted production-helper tests, rather than claimed as a native browser scenario.

The named browser session and both isolated workers were closed after verification. Evidence, homes and fixture repositories remain available for reproduction. Historical test-drive evidence is unchanged. No PR was created; delivery owns publication and the eventual changelog PR link.
