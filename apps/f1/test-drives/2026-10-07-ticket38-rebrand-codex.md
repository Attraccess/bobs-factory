# Ticket 38: rebrand and prepared Codex continuation

## Scope

Runtime and harness changes require F1 coverage. This drive verifies explicit
repository/agent selection, worktree creation, native Codex startup, timeline
responses and continuation with the same provider session. It does not establish
cross-home migration, all-provider support, tool lifecycle rendering or all-target
binary compatibility.

## Environment and scenarios

macOS ARM64, Bun 1.4.2 for checkout F1, prepared host Codex and an isolated Git
repository `/tmp/bobs-factory-ticket38-f1-repo`. Test homes were isolated from
operator state; existing host authentication was used. No files or PRs were
requested from the agents. The test repository has no origin; GitService correctly
used local `main` after its expected fetch warning.

1. Checkout F1 server on port 4390, isolated HOME and explicit CODEX_HOME.
   DEF-2 selected `[repo=f1-test-repo]` and `[agent=codex]`.
   The response activity was `FACTORY38_NATIVE_OK`. A follow-up returned the
   remembered token `PANCAKE38`. Runtime logged `needsNewSession=false`.
2. Installed compiled executable on dashboard 4400 / RPC 4401, separate isolated
   home. DEF-1 selected `[repo=local]` and `[agent=codex]`.
   The response was `FACTORY38_BINARY_OK`; the same-session follow-up returned
   `BINARY38`. The factory launched the prepared native Codex app-server command.
3. The initial checkout issue without a repository selector produced repository
   selection elicitation. The routed second issue was used for the continuation
   assertions; the pending first issue is not counted as a completed drive.

## Outcome and limits

Both response and continuation assertions passed. The compiled Darwin ARM64
artifact also passed isolated installation and startup/assets/API/MCP/shutdown/
restart smoke with no factory Node or Bun on PATH. This is a dirty development
candidate, not release evidence. Other native targets, Cursor native resources,
full migration continuation and aggregate third-party notices remain pending.
No release, PR, stable tag or ticket lifecycle mutation was performed.

Redacted activity exports and desktop/mobile screenshots are in the run evidence
directory `manual-7f0c7c6e-cca1-4387-b7ee-7d81e06997ba`. Historical drives were preserved.
