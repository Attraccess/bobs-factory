# Web Push integration with question guidance

Date: 2026-10-07. Draft PR: [#35](https://github.com/Attraccess/bobs-factory/pull/35).
Tested merge of `235d22de3c3ba2f47c491b8323e729b52e0af371` and
`b317ea9e3c8a4d26a9617c9bf2dc90cff2495ef7`. Staged tree before this report:
`8a32a4cc90332368ed680d351d41c694c4feb3aa`.

Only the changelog conflicted; both entries were retained. Runtime changes
merged without conflicts. F1 applies to the merged generated instructions.
The inspected `/tmp/bob-human-language-f1.mjs` driver was rerun with
`F1_AGENT_MODE=mock` against the newly built workspace. Every runner, including
automatic titles, used `MockAgentRunner`; no live provider calls were made.

## Executed evidence

- The isolated CLI tracker created DEF-1 / session-1 and a fresh worktree.
  Factory used loopback port 3549; F1 RPC used loopback port 3600.
- Three saved-fixer executions with `askQuestions: false` received the complete
  shared communication addendum and run-specific question instructions, while
  retaining the custom prompt.
- Full questions reached the dashboard API and tracker activities. An
  explanation-only reply left the run waiting without executing its receipt.
  An explicit fixture answer completed it and retained both human messages.
- The worker and listeners stopped cleanly. Receipts are in
  `/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/bob-human-language-f1-iMPbtf/receipts.json`.
  Drive log: `/tmp/manual-74357df8-ci-f1.log`.
- All 83 focused tests passed across capture recovery, runner prompt addenda,
  routing prompts, questions, push, notification controls and PWA behavior.
  Root build/typecheck and diff checks passed. Biome passed with 29 existing
  warnings. Factory web build remains `6f066880d91656f35ef3c72f`.

## Limits

Canned output validates instruction delivery, transport and waiting behavior,
not live-model reasoning. No web rendering code changed in this integration;
prior accepted screenshots and authenticated HTTPS evidence are preserved.
Native push delivery/focus, physical devices and production Tailscale remain
unverified. The accepted node-forge/braces exception and tracker snapshot
discrepancy remain documented. No readiness change, merge to main or tracker
lifecycle mutation was performed.
