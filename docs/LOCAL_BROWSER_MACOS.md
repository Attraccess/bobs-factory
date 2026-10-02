# Local Chrome and Brave with sandboxed Cyrus

On macOS, Codex's command sandbox can prevent Chromium from registering with
LaunchServices and connecting to WindowServer, even in headless mode. The
`agent-browser` CLI reports that Chrome exited without writing
`DevToolsActivePort`. Brave uses the same Chromium startup path. Allowing
`~/.agent-browser` writes solves socket/state permission failures, but does not
solve these macOS service denials. `--no-sandbox` affects Chromium's own
sandbox, not the outer Codex sandbox.

The optional local companion starts a dedicated browser daemon from a user
LaunchAgent. The CLI wrapper asks it to prepare a session, then executes the real
`agent-browser` command in the caller's environment. The host helper accepts only
a generated session id, a Chrome/Brave executable from its installed allow-list,
the caller’s existing directory, and a debug boolean. It does not accept shell
commands or arbitrary executable paths. Browser daemons run on the host; browser operations therefore have the
normal access of the local user. Codex's other commands keep their sandbox.

## Install

With Node, `agent-browser`, and Chrome or Brave already installed:

```sh
node scripts/local-agent-browser.mjs install /opt/homebrew/bin/agent-browser
```

The installer copies the helper to `~/.cyrus/browser-host`, installs a wrapper at
`~/.cyrus/bin/agent-browser`, links it from `~/.local/bin/agent-browser`, and loads
`~/Library/LaunchAgents/com.cyrusagents.browser-host.plist`. It refuses to
overwrite an existing wrapper. Put `~/.cyrus/bin` first in the Cyrus service's
PATH and in its persistent service configuration, then restart Cyrus while idle.
Login shells may rebuild PATH; keep `~/.local/bin` ahead of Homebrew there and
check `command -v agent-browser` inside the actual agent shell.
The helper's log is `~/.cyrus/browser-host/host.log`. Its bootstrap Unix socket
is `~/.agent-browser/cyrus-host-bootstrap.sock`, accessible only to its owner.

Keep `~/.agent-browser` writable in the runner. This companion does not change
runner filesystem permissions. With the configurable writable-directory support
from [PR #1516](https://github.com/cyrusagents/cyrus/pull/1516), add the following
to `~/.cyrus/config.json` and start a fresh session:

```json
{
  "sandbox": {
    "additionalWritableDirectories": ["~/.agent-browser"]
  }
}
```

Without that support, the runner must provide an equivalent writable root.
Network access alone is insufficient. Keep browser support enabled with
`CYRUS_BROWSER_USE_ENABLED=1` so Cyrus includes its browser-use instructions.

## Use

Use the CLI normally, keeping the same named session and working directory for
related commands:

```sh
agent-browser --session smoke open https://example.com
agent-browser --session smoke get title
agent-browser --session smoke screenshot ./browser-smoke.png
agent-browser --session smoke close
```

Use `--executable-path` to select Chrome or Brave. The choice is retained for
later commands, including when the environment defaults to the other browser.
Sessions are mapped to short host names using a hash of the working directory and logical session name. This
also isolates agents that omit `--session`. `session list` shows these physical
names; its metadata commands are passed directly to the underlying CLI.

The helper prepares temporary headless profiles with an empty config. It is
intended for ordinary local Chrome/Brave verification. Custom profiles, cloud
providers, and daemon policy options other than `--debug` are not validated by
this companion. CLI-only commands such as `skills`, `install`, and `doctor`
bypass preparation; `doctor` can still report the outer sandbox launch denial.

The installer is intended for a first installation and refuses to overwrite
existing wrappers or a LaunchAgent, including dangling symlinks. For an update,
close sessions and remove the previous installation before installing again.

After a Homebrew upgrade that removes the CLI's old Cellar path, update
`~/.cyrus/browser-host/config.json` to the new real CLI path. Keep Node available
at the absolute path recorded in the wrapper and LaunchAgent.

## Remove

Close your named browser sessions first, then:

```sh
launchctl bootout "gui/$(id -u)/com.cyrusagents.browser-host"
rm ~/.cyrus/bin/agent-browser
rm ~/.local/bin/agent-browser
rm ~/Library/LaunchAgents/com.cyrusagents.browser-host.plist
```

The installed helper, settings, and log can be retained for diagnosis or removed
from `~/.cyrus/browser-host`. Remove the PATH addition from the persistent Cyrus
service configuration if no other local wrappers use it.
