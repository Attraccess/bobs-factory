# Review brief

Date: 2026-10-10. Tested the working tree based on `4d0ffd78` with the review
brief changes. Driver: [`assets/review-brief.ts`](assets/review-brief.ts).
Evidence: `/tmp/bobs-review-brief-f1-P6mFDW` (`receipts.json`, one run JSON per
scenario, `descriptions.md` with every published PR description); command log
`/tmp/review-brief-f1.log`.

## Changed behavior

Stock guide steps declare `guideContract: "brief-v1"` and author a review brief:
the ask and its interpretation, one proof per requirement, decisions for the
human, system flows when relevant, and what changed beyond the ask. The runtime
stamps the contract, validates authoring rules and evidence together (inventory
coverage, PR files, accepted screenshots/videos, flow references, no local paths
or SHAs in prose), routes gaps and `not-ready` verdicts back through correction,
publishes brief Markdown to the PR, and opens the brief reader for human review.
Steps without the contract keep the chapter guide unchanged.

## Applicable F1 scenarios

Runner/workflow lifecycle, generated role instructions and handoff publication
changed, so F1 applies. The driver used a fresh repository, real isolated Git
worktrees, a CLI-platform EdgeWorker (RPC port 3601), the protected Factory API
(port 3541) and deterministic MockAgentRunner roles. GitHub responses were
scripted. No native coding agent or inference API was invoked.

```sh
pnpm --filter bobs-factory-edge-worker build
F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/review-brief.ts
```

Each issue was created and started through the F1 CLI. A seed step committed
`feature.txt` in the run worktree, so `/progress/reviewScope/files` held one real
changed file.

- **Brief, corrected and approved:** the first brief carried a local absolute
  path in prose and explained no file. One rejection reported both problems; the
  same role corrected them. Handoff published Markdown containing the quoted ask
  and "Does it do that?", without local paths, and stopped at the human gate with
  the current HEAD. Brief roles received the brief runtime instructions. The
  protected API returned the stamped brief; an explicit approval completed the run.
- **Brief gap:** the first brief marked its requirement `gap` and `not-ready`.
  Handoff routed it to `ci-fix`, which saw the brief in `/feedback/guide`; the
  regenerated brief was ready and reached human review. No guide was published
  before correction.
- **Legacy chapter guide:** a guide step without the contract received the
  chapter instructions, produced a chapter guide with no contract, published the
  chapter Markdown and reached human review.

Receipt:

```text
scenario   guide turns  ci-fix  contract   final
brief                2       0  brief-v1   completed (approved)
gap                  2       1  brief-v1   human-review (waiting)
legacy               1       0  chapters   human-review (waiting)
```

Exactly three provider description publications occurred, one per accepted
guide. Every run bound a review-file snapshot. F1 `view-session` returned session
activity for each run. No unhandled rejection occurred and shutdown completed.

## Additional verification and limits

Unit tests cover brief schema rules, inventory coverage against a real
specialist aggregate, file accounting, screenshot references, `sinceLastReview`,
contract stamping, file indexes, recovery routing, Markdown, the combined
rejection and upgrades of every released stock chapter-guide prompt. The reader
was checked in a browser against four converted real runs (a wording fix, a
date/time feature, release tooling and SSO logout with sequence diagrams), and
through the website demo used for the marketing screenshots. Full edge-worker
tests, repository typecheck, Biome, the package build and the website build passed.

The brief reader's rendering is not asserted by this driver; it was verified
visually. Real guide-agent output quality under the new prompt still needs
observation on live runs.
