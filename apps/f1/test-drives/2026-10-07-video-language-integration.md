# Video evidence and human communication base integration

Date: 2026-10-07. Tested PR #33 HEAD `b6cf31c73dc37e853d03fa23becac461b283e85d`
merged with base `b317ea9e3c8a4d26a9617c9bf2dc90cff2495ef7`, before the merge commit.
Runtime diff SHA-256 against that HEAD (edge-worker source and prompts):
`f3dbf2a55efc6aff6d40ae69c45af29da23d472d4d3ea78aea91b42e942d9caa`.

## Scope and expectations

The changelog conflict retained both changes. The automatic runtime merge brings
the base's shared communication addendum and question instructions for saved
fixers together with this PR's video-contract normalization and validation.
F1 applies to generated runner instructions. No video-player code changed.

Expected behavior: a saved fixer with `askQuestions: false` receives the complete
question guidance and shared communication addendum, retains its custom prompt,
posts its full question to the API and tracker, and waits for an explicit answer.
An explanation-only reply must keep it waiting. Existing scenario-reuse and
retention safeguards must still pass with recorded media.

## Execution

Evidence prefix:
`/Users/jappy/.cyrus/factory/evidence/manual-30032642-7584-4d54-9ff6-0baa919d6148/`.

```sh
pnpm build
F1_AGENT_MODE=mock node <evidence-prefix>/ci-language-integration-drive.mjs
F1_AGENT_MODE=mock bun run <evidence-prefix>/ci-language-integration-video-drive.ts
```

The communication replay uses the built EdgeWorker, F1 CLI tracker and activity
sink, real factory-context input and `MockAgentRunner` for all provider calls.
Fresh disposable repository/home; RPC port 3610 and dashboard port 3551.

- All three fixer executions received the full shared addendum, full run-specific
  question instructions and saved custom prompt.
- The entire question reached the dashboard API and tracker response activity.
- An explanation-only reply reran the fixer but kept the receipt step pending.
- An explicit fictional fixture answer completed the third fixer and receipt.
  This answer authorizes no production exception or paid testing.
- Both owned listeners stopped cleanly. Full receipt:
  `/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/bob-human-language-f1-gchsGv/receipts.json`.
  Log: `ci-language-integration-f1.log`.

The video replay uses deterministic workflow hooks, the real runtime, validator,
gate and startup maintenance, plus a previously recorded Save clip. It makes no
new recording or playback-inspection claim.

- Linked fixtures, preconditions, actions and expected criteria changes all
  rejected reused recordings. An unrelated-story change reused the clip and
  passed the real video gate.
- Startup maintenance deleted 200 expired assets, then the remaining six,
  including superseded captures; metadata and history survived.
- The expired media endpoint returned HTTP 410.
- Receipt: `ci-language-integration-video-receipt.json`.

## Targeted checks and limits

Six affected suites passed, 138 tests total: video validation, capture recovery,
runner prompt addenda, result validation, workflow runtime and complete routing
prompt expectations. Build, changed-file Biome and diff checks passed.

These replays establish instruction delivery, waiting/resumption, validation and
cleanup with simulated agents. They do not establish real-model readability or
provider behavior. Historical browser evidence remains intact, including verified
Playwright fallback. Native Safari/iOS and live ticket synchronization remain
unverified. Current-revision review and explicit human approval remain pending.
