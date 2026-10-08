# Specialist review findings: retained dispositions and nested provenance

Date: 2026-10-07. Tested `f717c5abfca1299d87db046b78ba78ea4aacf2d0` plus the review fixes in PR [#32](https://github.com/Attraccess/bobs-factory/pull/32).

F1 applies to the changed review history, nested workflow association, QA validation and approval safeguards. This delta drive uses deterministic provider responses through the compiled EdgeWorker, real CLI tracker/RPC, production agent output correction, configured fanout and persisted runtime. It supplements the earlier native-agent drive in `2026-10-07-specialist-requirement-review.md`; it does not claim new native model inference or remote provider publication.

## Scenarios and results

- **SR-001:** DEF-2/session-2 settles a finding in round one, omits it in round two, then tries reopening it without fresh evidence in round three. The second aggregate retains the resolved disposition. Production output validation rejects the third response, exhausts its two correction attempts, and fails before a third aggregate can approve. Focused tests additionally cover accepted rejections, direct aggregation and a reopening supported by fresh evidence.
- **SR-002:** DEF-1/session-1 calls a child extraction/review workflow, then runs QA in a different called workflow and builds its guide in the parent. The child returns `child/specialist-review` as the persisted review association. The parent guide contains authoritative R1 coverage and all six specialist receipts. A real FactoryTools human-review invocation with a controlled GitHub readiness receipt rejects a changed local head. No approval or publication occurs. The run stops at the parent human-review checkpoint.
- **SR-003:** The child aggregate tool is named `aggregate-review`, with no `review-gate` output. Production QA finalization accepts the stable `R1` story reference using the configured aggregate's inventory. Targeted tests preserve missing-story/exclusion validation and the renamed gate's unchanged-revision readiness behavior.
- **Restart:** After graceful shutdown/restart, both final runs retain identical status, step, histories, outputs, review rounds and checkpoints. The parent review association remains `child/specialist-review`; completed reviewers are not replayed.
- **Browser:** A fresh named headless Chromium session opens the parent review guide, expands requirement coverage and confirms R1 is met. The captured screenshot was visually inspected. The browser and isolated worker were closed afterward.

The fixture uses isolated home `/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/fix73-home-RrqjqL`, repository `/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/fix73-repo-BcqEHs`, dashboard/RPC ports 3883/3884, and a separate capacity pool. Reproducible script and receipts are in `/Users/jappy/.cyrus/factory/evidence/manual-0b7cf77f-8296-4e61-9df5-b03561e59729`: `review-fixes73.mjs`, `review-fixes73-approval.json`, `review-fixes73-restart-checks.json`, and `review-fixes73-observation.json`.

```sh
pnpm build
node <evidence-directory>/review-fixes73.mjs
CYRUS_PORT=3884 apps/f1/f1 create-issue --title 'Nested review safeguards' --description '<accepted null-input criterion and nested provenance scenario>' --labels workflow:fix73
CYRUS_PORT=3884 apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3884 apps/f1/f1 create-issue --title 'Retained settled finding' --description 'reopen: <three-round retained disposition scenario>' --labels workflow:fix73
CYRUS_PORT=3884 apps/f1/f1 start-session --issue-id issue-2
agent-browser --headed false --session review-fixes73 open 'http://127.0.0.1:3883/#/runs/session-1/review'
```

Fixture preparation initially omitted required QA/guide fields and provider base/PR receipts. Output validation rejected those incomplete inputs. An early fixture retry also made an unnecessary empty commit; the new parent safeguard correctly rejected its stale guide revision. The final fixture avoids retry commits and supplies those receipts. Earlier preparation evidence remains separate from final passing assertions. A restart attempted before the prior listener released its port failed with EADDRINUSE; retry after release succeeded.

## Checks and limits

205 relevant tests passed: specialist contracts/runtime/QA/guide/readiness (159), configuration/server/takeover/machine capacity (31), and integration capacity (15). Root build and typecheck passed. Root lint passed with 29 existing warnings; changed TypeScript files pass Biome without warnings. Whitespace checks passed. No dependency changes.

[Parent guide screenshot](/Users/jappy/.cyrus/factory/evidence/manual-0b7cf77f-8296-4e61-9df5-b03561e59729/review-fixes73-parent-guide.png). UI code is unchanged. Remote CI, publication, human approval and merge were not exercised. Runtime tracking retains ownership of the originating ticket; this drive made no production ticket mutations.
