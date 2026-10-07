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
| Coordinator | MachineCapacity and execution scope | `~/.bobs-factory/machine-capacity` | Stop old consumers and descendants before transfer |
| Repo hooks | GitService setup / teardown | `bobs-factory-setup.sh`, `bobs-factory-teardown.sh` | Rename only explicitly approved repository files |
| Owned MCP references | registrations, allowlists, prompts | `bobs-factory-tools`, `mcp__bobs-factory-tools__*` | Transform operational tool references, never transcripts |
| Stock skills / plugin | deployer, runner configs, instructions | `bobs-factory-skills`, `bobs-factory-skills-plugin` | Preserve custom skills and prompts |
| Certificates / sandbox | worker home, runner environment | `<home>/certs`, `BOBS_FACTORY_*` | Preserve keys, normalize path fields |
| Prepared Cursor SDK | binary runner / external Node host | `BOBS_FACTORY_CURSOR_SDK_PATH`, `BOBS_FACTORY_CURSOR_NODE` | Keep SDK/native files external; preserve native IDs |
| Distribution | build, CI, installer, metadata | versioned four-target archives + SHA-256 manifest | Stage replacement separately from mutable state |
| External wire protocol | upstream HTTP adapters / MCP contexts | `X-Cyrus-Team-Id`, `X-Cyrus-Config-Capabilities`, `x-cyrus-mcp-context-id` | Retain ASCII protocol names; no hosted enrollment |
| Dashboard | FactoryWebAssets, build script, server | immutable shell inventory, existing PWA protocol | Rebuild shell; keep API/SSE and workflow IDs |

External cyrus-hosted tool catalogs are absent from this repository. They cannot
be updated here. This independent fork does not enroll with the upstream hosted
control plane. Migration must flag hosted-only setup for explicit conversion.

The issued egress certificate keeps its existing `cyrus-egress-ca.pem` filename
inside the new home. Migration preserves certificate/key bytes and system trust;
this retained artifact name does not enable an old command or home fallback.
