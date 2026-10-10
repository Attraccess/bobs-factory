# Settings passkey enrollment survives session rotation

Date: 2026-10-09. Taskbot #40, draft PR #71.

Tested the working-tree fix on `f04f674410ee849e40a3165df03791721f56e15d`.
The browser receipt binds the code/test delta with SHA-256
`481ba826c66fa95685a7d6c7b9257b944fe6b07e05c4b52a5ea4ef25fa9e31d4`;
the served UI build is `36ed11e1c35dd42afa280b19`.

## Reproduction and correction

Before the fix, the complete mobile Settings flow verified the existing passkey
but saved no second key. Rotation invalidated the live stream's old session,
so the browser cleared Settings as if the connection had failed. Private
requests made with the old cookie could also return 401 after successful
verification and clear the new session.

The client suspends the live stream during verification, cancels requests bound
to the old cookie, and resumes with the verified session. Late old-session
responses cannot clear the current session. Genuine connection loss and current
session denials continue to clear private views and unsent forms.

## Relevant isolated F1/browser validation

The fixture runs the actual built FactoryServer, WorkflowRuntime and durable
authentication store under a disposable home. Its workflow agent, script and
tool handlers are simulated; no native agent or provider credits are used.
A local HTTPS proxy preserves the configured external Host and browser Origin.
The fresh, explicitly headless `agent-browser` session uses Chromium software
authenticators with actual WebAuthn verification, at 390×844.

Evidence directory:
`/Users/jappy/.bobs-factory/factory/evidence/manual-58cb7337-4661-439e-a18e-6a7f063c4cae/qa40-key-fix`.

Commands in that directory:

```sh
node fixture-server.mjs
agent-browser --headed false --session qa40-key-fix-management --ignore-https-errors open https://qa40.localhost:47940
F1_AGENT_MODE=mock node drive.mjs
```

All eight browser checks passed:

- Public setup rejects private reads.
- First-key setup completes actual registration through the HTTPS UI.
- Settings verifies the existing key, registers a second authenticator and
  displays both saved names with the add form closed.
- Cancelled Settings registration saves no key and retains the named form.
- Offline loss clears private Settings; reconnect verifies and restores access.
- Settings removal verifies again and revokes the current credential's session.
- The remaining key restores access; removing the last key remains blocked.
- Expired sessions clear private views and private reads return 401.

`browser-results.json` and `management-results.json` record the outcomes.
The full-page `mobile-restored-settings.png` was inspected: both keys, their
removal controls, Add passkey and Sign out are readable, with no horizontal
overflow and no unsent add form. Screenshot content contains no setup code or
session token.

The 76 tests in FactoryWebClient, FactoryPwa, FactoryAuth and FactoryAccess
passed. The new regression checks both rejection of a late old-cookie 401 and
clearing private caches for a current-cookie 401. Edge-worker build, typecheck,
Biome and whitespace checks passed.

## Limitations

This is isolated HTTPS/software-authenticator coverage. Physical Safari,
biometrics, cross-device enrollment, production zrok2 routing and live OAuth
remain unverified. Production services, tunnels and native credentials were
unchanged. Subsequent reviewers must reassess the fix and fresh screenshot.
