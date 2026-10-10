# Bob’s Factory contract inventory

The fork is Apache-2.0; preserve the upstream LICENSE, NOTICE and source attribution.
Historical changelogs and F1 reports retain their original names and commands.
Native Claude/Codex/Cursor/Gemini/OpenCode, Git, SSH and signing stores remain host-owned.

| Contract | Maintained producer / consumer | New representation | Explicit migration |
| --- | --- | --- | --- |
| Executable / service | CLI, launcher, install / service docs | `bobs-factory` | Replace approved service command; no alias |
| Owned packages | manifests, imports, filters, lockfile | `bobs-factory-*`, private | Build-time only |
| Product environment | CLI, worker, runners, capacity, helpers | `BOBS_FACTORY_*` | Rename keys, refuse collisions; keep provider keys |
| Home configuration | application, worker, config | `factoryHome`, `~/.bobs-factory` | Transform config field and owned paths only |
| Persistence | worker state, factory runs / chats / evidence | `<home>/state`, `<home>/factory` | Preserve versions, IDs, receipts, gates, accepted definitions |
| Coordinator | MachineCapacity and execution scope | `<factoryHome>/machine-capacity`, one pool per instance | Stop old consumers and descendants before transfer; capacity-directory overrides block apply until explicitly reconciled |
| Repo hooks | GitService setup / teardown | `bobs-factory-setup.sh`, `bobs-factory-teardown.sh` | Rename only explicitly approved repository files |
| Owned MCP references | registrations, allowlists, prompts | `bobs-factory-tools`, `mcp__bobs-factory-tools__*` | Transform server-wide allow/deny entries, saved/frozen workflow tool steps (including fanout/nested definitions), server keys and owned HTTP routes; preserve prompts and transcripts |
| Stock skills / plugin | deployer, runner configs, instructions | `bobs-factory-skills`, `bobs-factory-skills-plugin` | Preserve custom skills and prompts |
| Certificates / sandbox | worker home, runner environment | `<home>/certs`, `BOBS_FACTORY_*` | Preserve keys, normalize path fields |
| Prepared Cursor SDK | binary runner / external Node host | `BOBS_FACTORY_CURSOR_SDK_PATH`, `BOBS_FACTORY_CURSOR_NODE` | Keep SDK/native files external; preserve native IDs |
| Distribution | build, CI, installer, metadata | frozen stable/nightly candidates, four-target archives, signed schema-2 manifest + SHA-256 inventory | Stage replacement separately from mutable state; immutable schema-1 beta requires additive signed attestation |
| Release discovery | installer, Pages, Nix, future updater | stable/default (authenticated beta fallback), explicit nightly, exact version; pinned RSA/SHA-256 keys | Preserve signed bytes; refresh trusted bootstrap for key rotation; no unsigned fallback |
| Publication | release workflows, publisher | repository-wide lock; retained asset/approval digests and recovery receipts; ordering against complete published provider history | Publication disabled until protected key/rollout setup; stable approval binds exact signed bytes; unknown signing keys cannot hide newer stable releases or bypass nightly eligibility |
| External wire protocol | upstream HTTP adapters / MCP contexts | `X-Cyrus-Team-Id`, `X-Cyrus-Config-Capabilities`, `x-cyrus-mcp-context-id` | Retain ASCII protocol names; no hosted enrollment |
| Operator MCP | CLI, worker, operator grant store | `bobs-factory-operator`, `operator`, `operator-mcp`, `<home>/factory/operator` | Local owner grants; dashboard passkeys and accepted run profiles remain separate |
| Dashboard access | CLI, FactoryServer, private authentication store; client clears private views on connection loss and rechecks sessions on reconnect | `factory-auth`, `--origin`, `--session-hours`, `BOBS_FACTORY_FACTORY_*`, `<home>/factory/auth` | Preserve authentication files; existing origin bindings require explicit recovery when changed |
| Terminal dashboard | CLI, FactoryServer, private authentication store | `tui`, `--theme`, `--home`, `--port`, localhost-bound terminal sessions | Local operator filesystem authority; memory-only session hashes, no browser credential or native store migration |
| Workflow catalog | defaultWorkflows, WorkflowCatalog, WorkflowRuntime and native adapters | code-owned bundled behavior; separate preferences, launch settings and availability; private fork graphs | digest-bound backup/receipt of legacy config; preserve custom graphs, frozen runs and native IDs; individual Resume after disabling |
| Dashboard | FactoryWebAssets, build script, server | immutable shell inventory, existing PWA protocol | Rebuild shell; keep API/SSE and workflow IDs |

External cyrus-hosted tool catalogs are absent from this repository. They cannot
be updated here. This independent fork does not enroll with the upstream hosted
control plane. Migration must flag hosted-only setup for explicit conversion.

Dashboard passkey verification rotates the session cookie. The client suspends
the old live stream and cancels requests bound to the old cookie without clearing
the credential-management form. It reconnects after session verification;
connection loss, expiry and current-session rejection still clear private views.

Migration blocks `CYRUS_CAPACITY_DIRECTORY` and `BOBS_FACTORY_CAPACITY_DIRECTORY`
in the source `.env` or the helper's inherited environment. These overrides no
longer select a runtime pool. Reconcile custom/shared coordinator state and all
consumers explicitly, preserving policy, request identities and queue order in
the source home's `machine-capacity` directory; remove obsolete overrides from
environment files and service definitions, then regenerate the preview. The
helper validates the reconciled state before apply and relocates owned identities.

Migration validates persisted MCP JSON files and configured MCP references before
apply. External or linked files needing owned-reference changes, ambiguous relative
paths, legacy executable commands and conflicting old/new server keys require
explicit reconciliation. Migration never rewrites external MCP files or opaque
headers, environment values, tool arguments, completed receipts or review gates.
Workflow tool changes are limited to saved recipes and the run's top-level frozen
`workflow` / `workflowDefinitions`; workflow-shaped step outputs and checkpoint
outputs remain completed results, including when later steps consume them.
Singular `output` payloads in completed and rejected agent checkpoints (including
nested graph frames and Simple execution) remain opaque result data. Migration
does not rewrite their fields or interpret them as native conversation records.

The issued egress certificate keeps its existing `cyrus-egress-ca.pem` filename
inside the new home. Migration preserves certificate/key bytes and system trust;
this retained artifact name does not enable an old command or home fallback.

## Factory external ticket delivery

New stock planning outputs use `delivery-v1`. Clarification classifies repository,
external or mixed delivery; plan review confirms the exact contract digest.
Execution authorization (or deferral) is a separate referenced instruction.
Targets retain verified tracker coordinates, immutable IDs, URLs, complete
before-state, allowed operations, preserved relationships and criterion references.
The contract binds the accepted execution snapshot; credentials never appear in it.

`FactoryRun.delivery` retains the frozen contract, operation intent/before-state,
pending/applied/failed/uncertain/conflicted receipts and independent
`external-evidence-v1` snapshots. Snapshot digests normalize relationship ordering
and exclude lifecycle status, comments, PR links and volatile provider metadata.
Human gates/decisions retain optional delivery mode and external digest alongside
legacy Git evidence. Mixed decisions bind every exact repository revision as well.
External guides retain linked resources, applied changes, executed criteria and
limitations without inventing files, Git SHAs or screenshots.

External completion requires independent verification, explicit acceptance and a
fresh matching state check. Mixed delivery also requires provider-confirmed merges.
Delayed Done synchronization rechecks external state without replaying mutations.
Read failures and drift block closure. Review guides show pending ticket synchronization
and its error even after work is accepted; completion notices distinguish approved
work from unfinished tracking. Requested changes preserve applied work and
return through reviewed planning and reconciliation. Contract changes advance their
version, preserve previous contracts/receipts and invalidate affected acceptance.
Conflicted retries retain the reviewed baseline; observed intervening state never
authorizes an overwrite. Successful relationship operations reconcile both ticket
endpoints within the tracker scope. Mixed feedback before merge renews the plan
and external contract before repository corrections resume. After grouped merges,
external reacceptance runs once and binds all retained repository revisions.

Existing saved definitions remain readable and frozen. Authenticated external
recovery creates a separate `recoveryWorkflow` overlay and `deliveryRecovery` audit
record, retaining the original definition, checkpoint and history. It starts with
current-state reconciliation/verification, never replaying historical mutations.
See [the operator procedure](factory/external-delivery.md).

`externalReverifications` audits explicit operator transitions after delayed
external completion fails. The retained verification overlay resumes independent
reads and a fresh human gate, supersedes stale completion receipts and preserves
all applied work and confirmed merges. Tracking-only retries never start that
execution transition.

## Factory operator setup and recovery

Factory operator setup and recovery contracts are documented in
[factory-operator-mcp.md](factory-operator-mcp.md). Operator grants do not approve
review or merge; profile MCP repairs apply only to future accepted snapshots.
Listener errors identify the instance and requested run (when
supplied), with sanitized context and recovery guidance. Overlapping connection
edits return `stale_configuration`; overlapping run actions return `stale_state`.
