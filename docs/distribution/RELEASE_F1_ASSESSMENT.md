# First Bob’s Factory beta: full-payload validation assessment

Assessed on 2026-10-09 for the proposed `1.0.0-beta`. No earlier public Bob’s
Factory binary is the baseline. Upstream `v0.2.73` is useful inherited evidence,
not a previous Bob release or proof of the fork’s new runtime. The assessment
therefore includes the maintained fork functionality and its integration with
the inherited issue/session/agent paths, rather than only the version or PR #55.
The reviewed runtime integration is `ce846e8d` (PR #55, including PR #56).
The final beta SHA and build run must be supplied after the release tooling and
exact version are committed. This document does not assign a release pass.

## Applicability and existing coverage

F1 is required for this payload: routing, authentication, native execution
environments, workflow/session recovery, issue activity delivery, and human
review behavior have changed. Installer, binary packaging, release provenance,
license inventory and CI-only checks use their dedicated validation instead.
Historical reports retain their original failures, scope and source identities.

| Maintained behavior in the payload | Relevant existing functional evidence | Scope and remaining limits |
| --- | --- | --- |
| Issue assignment/routing, worktrees, Simple sessions, chat continuation and activities | [Upstream release assessment](../../apps/f1/test-drives/2026-09-29-cypack-1549-release-v0.2.73.md), [mocked issue/chat/background agents](../../apps/f1/test-drives/2026-10-07-mocked-agents.md), [current onboarding integration](../../apps/f1/test-drives/2026-10-09-native-delivery-onboarding-integration.md) | Historical Codex used a real account; current integration uses controlled agents and real isolated worktrees/activity paths. Upstream Claude authentication failed and is not reported as a successful turn. |
| Factory graph execution, questions, incremental chat, workflow selection and ticket ownership | [Workflow/session chat](../../apps/f1/test-drives/2026-10-05-workflow-session-chat.md), [workflow selector](../../apps/f1/test-drives/2026-10-05-workflow-selector-delivery.md), [settled ownership integration](../../apps/f1/test-drives/2026-10-08-settled-ticket-ownership-main-integration.md) | The reports document their actual scripted/native modes; they are behavioral evidence rather than four-platform release receipts. |
| Capacity, durable admission, cancellation and grouped delivery | [Machine capacity](../../apps/f1/test-drives/2026-10-06-capacity-chat-human-feedback.md), [grouped integration](../../apps/f1/test-drives/2026-10-08-video-grouped-integration.md), [native CI/delivery integration](../../apps/f1/test-drives/2026-10-09-native-delivery-onboarding-integration.md) | Latest integration asserts parallel implementation, serialized finalization, changed-base review, cancellation and release after a long provider wait. |
| Native conversation/checkpoint recovery, feedback/review invalidation and scoped MCP | [Codex startup recovery](../../apps/f1/test-drives/2026-10-07-codex-startup-recovery.md), [review recovery integration](../../apps/f1/test-drives/2026-10-07-specialist-main-recovery-integration.md), [context compaction](../../apps/f1/test-drives/2026-10-07-binary-context-compaction-integration.md), [current native delivery](../../apps/f1/test-drives/2026-10-09-native-delivery-onboarding-integration.md) | Existing reports exercise interruption, stored checkpoint/native IDs, completed-receipt retention and paged context. None grants new approval or authenticated agent coverage. |
| Passkey access, remote protected APIs, PWA updates, push attention and input lifecycle | [Passkey integration](../../apps/f1/test-drives/2026-10-07-factory-passkey-main-integration.md), [web push integration](../../apps/f1/test-drives/2026-10-07-web-push-main-integration.md), [input reset reconciliation](../../apps/f1/test-drives/2026-10-08-input-reset-base-reconciliation.md), [proxy/update handling](../../apps/f1/test-drives/2026-10-08-zrok-capacity-update-loop.md) | Software authenticators and controlled notifications verify protection/orchestration, not physical passkey hardware or arbitrary public proxy deployments. Current onboarding also rejects forged-origin/signed-out writes. |
| Specialist review, QA/capture/video evidence, guides and human approval | [Specialist fanout](../../apps/f1/test-drives/2026-10-07-specialist-post-review-fanout.md), [video execution integration](../../apps/f1/test-drives/2026-10-08-video-execution-integration.md), [guide map integration](../../apps/f1/test-drives/2026-10-08-specialist-guide-map-integration.md), [native delivery integration](../../apps/f1/test-drives/2026-10-09-native-delivery-onboarding-integration.md) | Scoped outputs and revision/base approval guards are asserted. Scripted screenshots or reviewer receipts are not described as a real model’s assessment. |
| Private identity profiles, native agent configuration, Git metadata and credential isolation | [Execution profile admission/recovery](../../apps/f1/test-drives/2026-10-07-execution-profiles.md), [current-base profile integration](../../apps/f1/test-drives/2026-10-07-execution-profile-current-base.md), [Codex Git permissions](../../apps/f1/test-drives/2026-10-08-codex-git-metadata-permissions.md), [onboarding](../../apps/f1/test-drives/2026-10-08-simple-install-onboarding.md) | These exercise explicit-profile precedence and no ambient credential fallback. Native permission probes use no inference; current scoped helper checks supplement the binary boundary. |
| Native GitHub API, GitLab/custom providers, bounded CI retries and SHA-guarded delivery | [Provider-neutral delivery](../../apps/f1/test-drives/2026-10-08-factory-git-providers.md), [onboarding](../../apps/f1/test-drives/2026-10-08-simple-install-onboarding.md), [combined native CI/delivery](../../apps/f1/test-drives/2026-10-09-native-delivery-onboarding-integration.md) | Controlled REST/GraphQL exercises current-head merge protection, metadata PATCH, same-SHA retry, bounded exhaustion and ambiguous-response restart deduplication. Merge queues have focused native API regressions, not a live queued merge receipt. |
| Signed Linear ingress, durable SDK delivery, throttling, credential rotation and transcript routing | [Linear ingress/delivery](../../apps/f1/test-drives/2026-10-08-linear-delivery-ingress.md), [audit/review context](../../apps/f1/test-drives/2026-10-08-factory-audit-review-context.md) | Actual Linear SDK with loopback GraphQL, signed embedded ingress and controlled failures. This does not claim a live Linear workspace/public tunnel test. |
| Migration, persisted capacity/workflow state and native continuation | [Migration/packaging](../../apps/f1/test-drives/2026-10-07-ticket38-migration-packaging.md), [rebrand/native Codex continuation](../../apps/f1/test-drives/2026-10-07-ticket38-rebrand-codex.md) | Historical waiting-native-conversation and real worktree-backlink/queue preservation checks exist. Their development archives and older SHAs do not supply the final candidate’s migration-preservation release gate. |

The latest combined drive compares source fingerprints before/after execution and
records 12 CI snapshots, 13 scripted role visits, 117 controlled provider operations,
49 real Git calls and 27 onboarding HTTP requests. It explicitly reports dirty
integration evidence. The final reviewer must bind the relevant runtime fingerprints
and preserved reports to the final candidate; metadata-only beta tooling does not
require inventing an unrelated F1 drive. Any subsequent runtime edit requires the
relevant scenarios again.

## Native release checks added

`binary-build.yml` runs the installed executable on `macos-15`, `macos-15-intel`,
`ubuntu-24.04` and `ubuntu-24.04-arm`. Each artifact must include:

- `runtime-smoke.txt`: installed invocation, startup, dashboard/assets, protected
  API/MCP, embedded runtime identity, shutdown and restart.
- `native-helpers.json`: actual native target and executable/resource digests;
  observed OS, kernel, CPU and Linux glibc; compiled Git credential/API/permission
  helpers under an isolated PATH; synthetic scoped tokens; a locally trusted HTTPS
  provider; foreign/missing-credential denial; empty HTTP 201 CI acknowledgement.
- `prepared-agent-boundaries.json`: the compiled factory’s external Cursor IPC
  create/resume/dispose with a synthetic SDK, and mocked protocol/environment
  checks for Claude, Codex, Gemini, OpenCode and Cursor. It explicitly records
  no authenticated provider or inference. It cannot satisfy `preparedAgents`.

On 2026-10-09 these new checks passed the clean installed Darwin ARM64 artifact
from `67c493c8f2edce81cf06d1efda6950ea7577651a`: macOS 26.6.2, Darwin kernel 25.6.0,
Apple M3; 228 selected adapter tests passed with one existing Gemini skip. The
native helper receipt is in `/tmp/native-helpers-clean67c-20261009/`; the final
boundary receipt is in `/tmp/native-boundary-clean67c-final-20261009/`. The boundary
receipt records the adapter checkout as `ce846e8d`, dirty, so it cannot satisfy
candidate-bound publication validation. This is genuine native development
validation, not evidence of a future beta build or the other targets.
Only successful candidate-bound native CI runs establish their actual platform
versions. No lower OS/glibc/CPU minimum, musl or Windows support is inferred.

## Concrete release gaps

1. A final reviewed, committed exact beta SHA, successful four-target native build
   and artifact-bound receipts are still required. Cross-compilation and old
   development archives are insufficient.
2. Current authenticated prepared-agent execution is not validated across all
   targets. The historical human Cursor authentication waiver was for its earlier
   implementation; it is not a new beta or four-target waiver. Claude’s historical
   expired/missing login, absent Gemini preparation, synthetic Cursor SDK and
   controlled OpenCode protocol are not successful authenticated turns. Preserve
   any separately supplied human waiver with its explicit target/provider scope;
   none is supplied or manufactured by this assessment. No paid provider call
   was authorized or performed for these checks.
3. The final candidate needs migration-preservation evidence covering home/config,
   persisted receipts and native continuation, plus exact runtime/dependency source
   and complete license/rebuild material. Older scoped F1 evidence informs those
   checks without automatically fulfilling the gate.
4. Publication intake must validate the complete full-payload F1 assessment and its
   actual receipts at the candidate identity. This matrix is an assessment, not an
   automatic `fullPayloadF1: passed` or `not-applicable` record.

The in-place instance update keeps its existing home, workspaces and native stores;
that narrower operational update does not require or establish a public beta release.
