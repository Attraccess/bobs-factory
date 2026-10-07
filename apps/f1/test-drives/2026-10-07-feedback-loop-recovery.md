# Factory feedback loop recovery

Date: 2026-10-07. Tested the working tree based on `1b30cfb0` on
`fix/factory-feedback-loops`, committed as `712b81ef` without runtime changes.
Driver: `/tmp/factory-feedback-drive.ts`.
Successful evidence: `/tmp/factory-feedback-f1-G9rvZk`, including five full run
JSON files, `contexts.json`, and `receipts.json`. Output:
`/tmp/factory-feedback-drive-final.log`.

## Applicability and setup

F1 applies to the Factory feedback gates, role output correction, and workflow
continuation changes. A real CLI-platform EdgeWorker ran on RPC 3600 and Factory
UI 3540 with a fresh unrelated Git repository, isolated home, and one capacity
slot. Every provider runner was replaced with a deterministic MockAgentRunner;
background title generation was disabled. Provider receipts and comments were
scripted. No native agent, inference API, real GitHub mutation, or provider credit
was used.

The cases use arbitrary feedback/build provider logins and an unrelated owner,
repository, PR number, and check name. No fixture depends on Kody, the reported
PR, or a repository-specific allowlist.

Each case started through `apps/f1/f1 create-issue` and `start-session` with a
workflow label. `view-session` verified response activities. Runtime history and
structured outputs supplied the assertions below.

## Scenarios and results

- **Persistent explicit ignore:** the owner instruction produced an author policy
  tied to the exact task input. Edited and new comments from that provider were
  ignored while an unrelated build notice was assessed once. One fixer and one
  initial code review completed; no repeated review occurred.
- **Exact outstanding comment correction:** the first mock fixer assessed the
  wrong comment. Runtime output validation named the actual missing ID, resumed
  the same conversation, and accepted the correction. Two mock invocations
  produced one completed fixer visit; no implementation or review was replayed.
- **No progress and restart:** an unchanged merge-conflict receipt paused after
  one fixer visit. The worker shut down and was replaced using the same home;
  the external in-memory tracker/activity sink were preserved. The saved wait
  recovered. Answering through `/api/runs/:id/answer` restored the fixture and
  resumed the existing fixer. Two total fixer visits and one review completed.
- **Actual code change:** a failed check caused a deterministic fixture commit.
  Changed revision provenance forced a fresh code review. One fixer, two reviews,
  and healthy final CI completed.
- **Reverse a policy:** an initial explicit ignore was followed by a newer user
  instruction to assess the author again. The newer policy prevailed. The
  provider edited the comment after the resumed role's snapshot, so that new
  content received one additional assessment. Three fixer invocations completed
  without redundant code review; the final content hash was retained.

All five runs completed. Their final readiness retained draft and required-human
approval blockers; none claimed approval or merged. All runner result costs were
zero. Final capacity was zero active/queued requests. The worker stopped cleanly,
freeing both ports. Historical evidence was preserved.

The first drive completed its workflows but failed an overly strict assertion
expecting two invocations in the reversal case. The provider intentionally edited
that comment after the role snapshot; the third invocation assessed genuinely
new content. The successful drive explicitly asserts three. Failed evidence is
retained at `/tmp/factory-feedback-f1-37kzgf`.

## Other verification

- 41 focused feedback-policy/readiness tests passed, including unrelated authors,
  serialization, revocation precedence, task/answer/chat/human-review authority,
  invented or edited instruction rejection, exact content hashes, missing
  assessment correction, fresh revision/job handling, and no-progress waits.
- All 1,353 EdgeWorker tests passed (one skipped). The initial parallel workspace
  run hit an unrelated `ENOTEMPTY` race while a persistence fixture removed its
  asynchronously initialized capacity directory. Its isolated four tests and
  the subsequent complete EdgeWorker run passed without changing that code.
- Other workspace package tests passed. Build, typecheck, Biome, and diff checks
  passed. Biome retained the existing warnings.
- CLI/F1 tests are recorded in the PR validation notes. The first concurrent CLI
  run exceeded default five-second limits in subprocess-heavy release fixtures;
  those fixtures were checked separately with a 30-second limit and one worker.

This is deterministic orchestration evidence. It establishes generic runtime
behavior, persistence, correction, and review routing; it does not establish how
an unmocked model will interpret every natural-language instruction.
