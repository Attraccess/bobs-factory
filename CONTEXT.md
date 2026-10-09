# Factory delivery vocabulary

Bob’s Factory is a fork of Cyrus. Preserve upstream attribution and native credential
stores; maintained product names and migration rules live in `docs/PRODUCT_CONTRACTS.md`.

- An **architecture proposal** combines repository evidence, responsibilities,
  interfaces, alternatives, trade-offs, visuals and a complete candidate implementation plan.
- A **proposal version** is runtime-owned identity plus a digest of the architecture,
  candidate plan and snapshotted assets. Model output never supplies human acceptance.
- **Architecture acceptance** authorizes implementation of one reviewed proposal version.
  It is separate from final approval of a delivered PR revision.
- **Discussion-driven revision** means the human supplies feedback and Bob generates a
  new proposal. Explanations keep the decision pending. There is no collaborative editor.
- A **routine bypass** records why unsplit work following established patterns needs no
  additional human architecture decision. It is not a fabricated approval.
- A **nested workflow** shares its parent run's execution and delivery context. An
  **independent child run** would own its own execution, recovery and delivered revision;
  that delivery model is planned separately and is not implemented by Taskbot #90.

See `docs/FACTORY.md` and `docs/adr/0001-independent-child-run-delivery.md` for the
workflow and extension boundary.
