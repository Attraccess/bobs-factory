# Factory passkeys after integrating current main

Date: 2026-10-07. Taskbot #79, draft PR [#27](https://github.com/Attraccess/bobs-factory/pull/27).
Tested `9d75c7fa87d97093f942c8d839ef206e6fa441eb` with the merge of
`1b30cfb0` and the conflict resolutions included in this commit.

## Scope and resolutions

The receipt had no failing GitHub checks or new PR comments/threads. The branch
matched the remote, but newly fetched main conflicted in the changelogs,
FactoryServer, workflow instructions and stylesheet. Both changelog histories,
capacity instructions, capacity events and authentication/UI styles are retained.
Every dashboard surface remains passkey protected, including localhost and the
new capacity endpoints. `CYRUS_FACTORY_PUBLIC_ORIGIN` remains a compatibility
alias for the HTTPS origin; explicit `CYRUS_FACTORY_ORIGIN` takes precedence.
Exact origin, request-header, session and challenge checks remain in force.
Two real-enrollment API tests cover alias use and explicit-setting precedence.

## Executed checks

- Eleven focused auth, server, PWA, review, workflow and routing-prompt suites:
  207 tests passed before adding the two alias tests.
- Five auth/capacity/recovery/prompt suites: 42 tests passed, including both
  newly added alias tests.
- Root build and typecheck passed. Repository-wide Biome passed with 29
  retained warnings. `git diff origin/main --check` passed. Comparing against
  the old branch exposes two existing Markdown hard-break whitespace lines in
  main's historical machine-capacity report; those lines are preserved.

## Isolated mocked F1/browser drive

A fresh EdgeWorker used a temporary home/repository, provider/RPC port 46578 and
UI port 46579. `F1_AGENT_MODE=mock` and `f1AgentHandlers("mock")` intercept every
runner, including the title job. No live agent CLI/API or production service was
used. The configured public origin was the synthetic `https://ci79.example.test`.
A fresh headless agent-browser session `ci79-sync-20261007` verified eight checks:

1. Local private config and capacity writes reject unauthenticated requests.
2. The configured public alias is admitted but still returns 401, even with
   forged localhost forwarding headers.
3. Operator-authorized cryptographic fixture registration succeeds and issues
   the real browser's HttpOnly session cookie.
4. Authenticated capacity read/write works, changing only the fixture limit.
5. A Simple workflow launched through the protected API completes with mocked
   activity/response output in its isolated workspace.
6. The authenticated completed run renders with sign-out controls.
7. Recipes renders the current instance capacity and controls.
8. Logout again blocks private config and capacity writes.

The setup at 390×844, completed run at 1280×900 and Recipes at 1280×900 were
captured and visually inspected. The initial driver used an incorrect settings
route; it was corrected to `/recipes` and the complete drive passed in a fresh
instance. Registration uses a cryptographic fixture rather than a native
browser authenticator. Existing physical-phone/tunnel evidence is preserved;
this drive does not claim a new phone test or production-origin deployment.

## Evidence and cleanup

Scripts, sanitized results and screenshots are under
`/Users/jappy/.cyrus/factory/evidence/manual-09e877cd-6bbb-4ad8-9aec-85b6d59877e8/ci-sync-20261007/`.
The named browser was closed and the temporary worker stopped. Human approval,
renewed review and production rollout remain separate. Live tracker status
synchronization remains unverified and owned by the runtime.
