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
| Distribution | build, CI, installer, metadata | versioned four-target archives + SHA-256 manifest | Stage replacement separately from mutable state |
| External wire protocol | upstream HTTP adapters / MCP contexts | `X-Cyrus-Team-Id`, `X-Cyrus-Config-Capabilities`, `x-cyrus-mcp-context-id` | Retain ASCII protocol names; no hosted enrollment |
| Dashboard access | CLI, FactoryServer, private authentication store; client clears private views on connection loss and rechecks sessions on reconnect | `factory-auth`, `--origin`, `--session-hours`, `BOBS_FACTORY_FACTORY_*`, `<home>/factory/auth` | Preserve authentication files; existing origin bindings require explicit recovery when changed |
| Terminal dashboard | CLI, FactoryServer, private authentication store | `tui`, `--theme`, `--home`, `--port`, localhost-bound terminal sessions | Local operator filesystem authority; memory-only session hashes, no browser credential or native store migration |
| Dashboard | FactoryWebAssets, build script, server | immutable shell inventory, existing PWA protocol | Rebuild shell; keep API/SSE and workflow IDs |

External cyrus-hosted tool catalogs are absent from this repository. They cannot
be updated here. This independent fork does not enroll with the upstream hosted
control plane. Migration must flag hosted-only setup for explicit conversion.

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
