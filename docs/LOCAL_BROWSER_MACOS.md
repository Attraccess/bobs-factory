# Local browser tools with Bob’s Factory

Bob’s Factory defaults Codex commands to native full access, allowing installed
shell tools, process inspection and local browser startup. The restrictions and
exceptions below apply when the operator explicitly selects `workspace-write`
or `read-only` with `codexSandboxMode`.

On macOS, Codex's command sandbox can prevent Chromium from accessing
LaunchServices and WindowServer, even in headless mode. A browser tool may report
that Chrome exited before writing `DevToolsActivePort`. Brave uses the same
Chromium startup path. Writable state directories address socket/cache errors,
but do not grant access to these macOS services. Chromium's `--no-sandbox` does
not disable the outer command sandbox.

## Native command exceptions as an alternative

Codex supports operator-managed execution rules for commands that need host
access. This mechanism applies to any trusted executable; Bob’s Factory does not need a
CLI-specific wrapper, argument parser, daemon protocol, or LaunchAgent.

For example, to allow the installed browser CLI, add this rule to a `.rules` file
under `~/.codex/rules/` (or the `rules/` directory under the Codex home used by
Bob’s Factory). Use the actual absolute path to the trusted executable on your machine:

```python
prefix_rule(
    pattern = ["/opt/homebrew/bin/agent-browser"],
    decision = "allow",
    justification = "Allow this trusted local browser tool to launch Chromium outside the macOS command sandbox",
)
```

`allow` runs matching commands outside the sandbox without an approval prompt.
Other commands retain the configured sandbox. Treat the whole matching executable
as trusted: its commands and child processes gain the local user's host access.
Keep the executable path and its installation controlled by the operator.

Rules match the command's argument prefix, not the resolved binary path. Tell the
agent to invoke the same absolute path as the rule. A bare `agent-browser` command
will not match the example above. For a narrower grant, include additional fixed
arguments such as `--session` and a particular session name in the prefix. Review
existing rules too: the most restrictive matching decision wins.

Check the rule before starting a fresh Codex process:

```sh
codex execpolicy check --pretty \
  --rules ~/.codex/rules/local-browser.rules \
  -- /opt/homebrew/bin/agent-browser --session smoke get title
```

The example assumes the rule was saved as `local-browser.rules`. Rules load at
Codex startup; existing processes do not automatically gain the exception. If
Bob’s Factory retains an existing runner process, restart Bob’s Factory while idle. A restrictive
managed policy may prevent an operator-defined exception. Complex shell scripts,
variable assignments, or substitutions may not match a command rule; use separate
plain invocations. See the [official Codex rules documentation](https://learn.chatgpt.com/docs/agent-configuration/rules)
for configuration layers and shell parsing behavior.

## Browser example

Run the original CLI directly with a unique session name for each agent/worktree:

```sh
/opt/homebrew/bin/agent-browser --session smoke-chrome open https://example.com
/opt/homebrew/bin/agent-browser --session smoke-chrome get title
/opt/homebrew/bin/agent-browser --session smoke-chrome screenshot ./browser-smoke.png
/opt/homebrew/bin/agent-browser --session smoke-chrome close
```

The Bob’s Factory process may set `AGENT_BROWSER_EXECUTABLE_PATH` to Chrome. When testing
Brave in that environment, use its `--executable-path` on every command, or set a
consistent executable in the runner environment. Changing it only for `open`
caused subsequent commands to switch to a blank Chrome session during validation.
There is no Bob’s Factory wrapper to retain tool-specific options automatically.

The native-rule smoke test used `workspace-write` and approval policy `never`.
Chrome and Brave passed open/title/screenshot/close, while an unrelated Python
command was denied a write outside the workspace. This verified an unattended
Codex session, not a new real Linear session using the rule. The earlier Linear
and F1 records describe the superseded launcher prototype.

## Filesystem settings and broader alternatives

`sandbox.enabled` in Bob’s Factory controls the egress proxy; disabling it does not
remove an explicitly configured Codex command sandbox. Bob’s Factory defaults the
Codex runner to `danger-full-access`. The operator can select a different mode
with `codexSandboxMode`. Changing
`~/.codex/config.toml` alone is insufficient when Bob’s Factory explicitly supplies the
thread's mode.

Bob’s Factory exposes the generic `codexSandboxMode` setting:

```json
{
  "codexSandboxMode": "danger-full-access"
}
```

This removes the sandbox for every Codex command in the session. Use explicit
`workspace-write` to enable the sandbox; removing the field restores full access. The setting
is independent of the browser CLI and the egress proxy; it also supports native
`read-only` execution. It affects issue and chat sessions when new runners are
constructed. See [configuration reference](CONFIG_FILE.md#codexsandboxmode) and
[official sandbox documentation](https://learn.chatgpt.com/docs/sandboxing).

Tools that still run inside the sandbox may need writable directories for
sockets and state. [PR #1516](https://github.com/cyrusagents/cyrus/pull/1516)
provides a generic `sandbox.additionalWritableDirectories` setting; filesystem
grants are independent of native host-command exceptions.

Another option is an externally launched browser exposing a loopback Chrome
DevTools Protocol endpoint. CDP-capable tools can attach through their own
connection options while their commands stay sandboxed. This needs separate
browser lifecycle/profile management, but can avoid granting host execution to an
entire CLI. Any future Bob’s Factory integration should use the standard endpoint rather
than a particular client's command line or private daemon protocol.
