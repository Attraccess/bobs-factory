# Factory service tiers: native runners, UI and recovery

**Date:** 2026-10-05 (Europe/Berlin)
**Candidate:** service-tier changes based on `475aca177d1dff3ebfcf5516ad8c900f6b094131`.
**Changed behavior:** independent Default/native, Standard and Fast selection for Codex and Claude in manual runs and owned workflow roles. Unsupported providers retain model aliases/variants.
**Fixture:** fresh `/tmp/factory-speed-drive`; persistent CLI issue tracker/EdgeWorker at `/tmp/factory-speed-fixture`, RPC 3492, UI 3491. Real installed Codex and Claude runners; no mocked model execution. Instrumentation recorded resolved runner/model/effort/tier before native runner creation.

## Scenarios and results

- Created DEF-1 with `workflow:speed` and started it through F1. Both agent steps returned `{"ok":true}`; tracker response activities were visible. Standard selected `service_tier=default`; the second step omitted an override, retaining native configuration.
- In T3 preview, saved a Fast owned-step setting and checked persisted workflow JSON. The already-created run retained its frozen definition. Factory parent displayed no shared roles; the shared pipeline displayed its twelve owned roles.
- Started `manual-277bc64d-4fc1-4daf-ad87-8ec451ecb4fd` through New run with Codex/Fast and low effort. A Standard step overrode the run tier; an unconfigured second step inherited Fast. Instrumentation reported `standard` then `fast`, unchanged `gpt-6.1-sol` model and low reasoning. Both native steps succeeded.
- Created DEF-2 with `workflow:claude-speed` through F1. Standard Claude Opus 5.5 completed in native session `a532ae0c-98f7-4495-b2a6-814116ad7ead`; result reported `usage.speed=standard`, `fast_mode_state=off`.
- Started `manual-94de299d-c31d-4d6a-9ced-f4285d83b782` with Claude/Fast via the local API. Native session `db709369-2e8d-4927-8666-507d5ea984f5` completed; result reported `usage.speed=fast`, `fast_mode_state=on`. This confirms Fast activation, not a benchmark or a guarantee for other accounts/models.
- Started Codex/Fast wait run `manual-5cdf01c7-f0fe-43c5-bd90-fb17fe9545bc`, shut down the isolated worker with SIGTERM after saving native checkpoint `01a1091d-494f-7a92-9307-146686fa22f8`, and restarted it. The same conversation resumed with tier Fast. Releasing its marker completed successfully; visit count remained one and previous history/outputs were retained.
- T3 desktop 1280×900 and mobile 390×844: no horizontal dialog overflow, accessible tier selects, two-column mobile roles. Codex/Claude show the tier; Gemini/Cursor/OpenCode hide and disable it. Switching providers clears incompatible settings; OpenCode shows its variant input instead. Fixed hidden labels being exposed by the existing form CSS.

## Commands and evidence

```sh
apps/f1/f1 init-test-repo --path /tmp/factory-speed-drive
CYRUS_PORT=3492 apps/f1/f1 create-issue --title "Service tier probe" --description "Return ok" --labels workflow:speed
CYRUS_PORT=3492 apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3492 apps/f1/f1 view-session --session-id session-1
```

The worker uses the existing persistent CLI fixture pattern with real `EdgeWorker`, `CLIIssueTrackerService` and `LinearActivitySink`. Workflow changes and manual launches use the same local API as the UI, with the required request header. The fresh repository has no origin; fetch warnings fell back to its local main branch as expected.

Targeted regression checks: FactoryAgentSettings/FactoryServer/FactoryPipeline (14 tests), AppServerCodexBackend (23 tests), ClaudeRunner/debugLogging (46 tests). These cover schema validation, same-provider inheritance, explicit Standard overrides, persistence, native thread configuration, merged Claude memory settings, and pre-warm bypass so explicit speed cannot be ignored. Workspace build/typecheck and staged formatting gates are required before shipping.

## Limits

Provider availability, extra usage costs, and native fallback remain provider decisions. Claude may switch incompatible models to supported Opus when Fast is requested. Cursor speed remains a model alias; OpenCode speed settings remain provider configuration/variants; no standalone Gemini speed switch was found. No external Linear mutations or operator worktree changes were made during this isolated drive. Fixture sessions completed and the fixture worker was stopped after verification.
