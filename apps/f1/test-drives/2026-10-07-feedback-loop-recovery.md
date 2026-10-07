# Factory feedback loop recovery

Date: 2026-10-07. Tested the working tree based on `1b30cfb0` on
`fix/factory-feedback-loops`, committed as `712b81ef` without runtime changes.
Driver: `/tmp/factory-feedback-drive.ts`.
Initial successful evidence: `/tmp/factory-feedback-f1-G9rvZk`, including five full run
JSON files, `contexts.json`, and `receipts.json`. Output:
`/tmp/factory-feedback-drive-final.log`.
Supplemental validation used the working tree based on `4f7ed6cf`, including
runtime-owned feedback context for recipes with restricted role inputs.
Final six-case evidence: `/tmp/factory-feedback-f1-I13n4U`, including six full run
JSON files, `contexts.json`, and `receipts.json`. Output:
`/tmp/factory-feedback-drive-six.log`.

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
- **Restricted recipe inputs:** the fixer received only `draft-pr` through its
  configured inputs. Runtime-owned feedback context still supplied exact pending
  comments and the original user instruction, allowing a valid author policy
  and assessment. One fixer and one review completed.

All six runs completed. Their final readiness retained draft and required-human
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
- The focused runner integration check also verifies policy validation when a
  custom recipe hides ordinary outputs and the original task input.
- Full EdgeWorker verification exposed intermittent `ENOTEMPTY` races in
  persistence and merge-recovery fixtures: constructor capacity initialization
  was still writing when cleanup removed their homes. Both fixtures now await
  that initialization before exercising their scenarios and removing homes.
  The final full suite passed all 1,354 tests (one skipped).
- Other workspace package tests passed. Build, typecheck, Biome, and diff checks
  passed. Biome retained the existing warnings.
- CLI/F1 tests are recorded in the PR validation notes. The first concurrent CLI
  run exceeded default five-second limits in subprocess-heavy release fixtures;
  those fixtures were checked separately with a 30-second limit and one worker.

This is deterministic orchestration evidence. It establishes generic runtime
behavior, persistence, correction, and review routing; it does not establish how
an unmocked model will interpret every natural-language instruction.

## Internal review recovery extension

The second reported run, `manual-56a8faa8-c83d-4083-a81b-b98174357df8`, completed
15 code reviews and 12 code-fix visits before exhausting its limit. Eleven
reviews retained the same protected-environment QA finding on clean, unchanged
revision `d3b5c920`. Fixers asked for deployment access only in their summaries,
returning no dispositions. Their frozen schema had no structured assistance
field, so the graph repeatedly advanced to review.

Replaying its retained final fixer result against the new contract identifies
`Missing finding IDs: WP-QA-003`; this now uses bounded correction in the same
role instead of restarting review. Code and visual fixers can return structured
questions. Runtime-owned review provenance also parks an unchanged attempt when
the reviewer still rejects the same consequential finding IDs, regardless of
changes to prose, timestamps or probe results. The finding remains blocking.

Driver: `/tmp/factory-review-recovery-drive.ts`. Initial supplemental evidence:
`/tmp/factory-review-recovery-f1-WKjobt`; output:
`/tmp/factory-review-recovery-drive.log`. This tested the working tree based on
`8acdaa90`, using another unrelated Git repository, isolated home, real CLI
EdgeWorker, RPC 3600/UI 3540 and deterministic MockAgentRunner for every role.
No inference or provider mutation occurred. Background naming was disabled.
The final drive also covers the completed parallel-checkpoint safeguards:
evidence `/tmp/factory-review-recovery-f1-hwUBNH`, output
`/tmp/factory-review-recovery-drive-complete.log`. All four scenarios passed.

- **Summary-only request with restricted inputs:** the first fixer omitted its
  required finding disposition. Same-role correction returned a real assistance
  question and waited before another review. The worker was replaced using the
  same home, tracker and activity sink; its wait recovered without launching a
  role. An API answer resumed the fixer, then fresh review accepted the resolved
  fixture. Three mock fixer invocations included one output correction; two
  reviews and one PR-fixture role completed.
- **Rejected unchanged attempt:** an evidence-backed rejection received one
  reviewer reassessment. The review retained the same finding with a newer 502
  probe rather than 404. The gate waited before another fixer. Restart preserved
  that gate and its unapproved finding; an API answer resumed the configured
  fixer, followed by fresh review. Two fixers and three reviews completed.
- **Actual source correction:** a real fixture commit changed the head SHA.
  Runtime provenance marked the fix changed and allowed fresh review without an
  assistance wait. One fixer and two reviews completed.
- **Visual fixer assistance:** the legacy visual flow retained a mock screenshot
  fixture and an unresolved finding while waiting for access. An answer resumed
  the visual fixer and a fresh visual review; no capture replay occurred. Two
  fixers and two visual reviews completed.

Every case launched via `create-issue` and `start-session`; `view-session`
verified response activities. Full run JSON, contexts and role-count receipts
were retained. Final capacity was zero active and queued; cleanup freed both
ports. Completion in these minimal fixtures means the review gate accepted
resolved scripted evidence, not human approval or a real merge. These drives
verify orchestration; they do not establish deployed HTTPS/device behavior.

Regression tests also cover unchanged rejected findings, real/uncertain/dirty
revision changes, changing findings, new answers/chat, restricted inputs and
unsafe assistance checkpoints inside parallel branches. The initial broad run
exposed the same pre-existing constructor-write cleanup race in workflow-trigger
fixtures; their cleanup now awaits capacity initialization as well.
The final full EdgeWorker suite passed 1,379 tests (one skipped); build, types,
Biome and diff checks passed, retaining the 29 existing Biome warnings.

## Main integration validation

Merged main `b9974c8b` into the tested branch based on `282dc5d9`, retaining
refinement recommendations, durable question batches and the recovery guards.
Review-fixer schemas retain optional recommendation metadata; both actual runner
integration cases assert it survives the restricted-input assistance path.
The combined EdgeWorker suite passed 1,396 tests (one skipped), and all 112
focused question/runtime/runner integration tests passed after that adjustment.
Build, types and diff checks passed.

All ten mocked scenarios passed again on the combined working tree. Feedback
evidence: `/tmp/factory-feedback-f1-RLyuY1`, output
`/tmp/factory-merge37-feedback-f1.log`. Review recovery evidence:
`/tmp/factory-review-recovery-f1-zxSjfQ`, output
`/tmp/factory-merge37-review-f1.log`. Both drives released capacity and stopped
cleanly; no provider inference or external mutation occurred.
