# Bob’s Factory CLI

Install a versioned binary with its matching checksum manifest using the
[distribution guide](../../docs/distribution/README.md). Workspace packages are
private; npm installation is not the fork's distribution method.

```sh
bobs-factory --repo ~/code/my-project --agent codex
```

Open the loopback dashboard at http://127.0.0.1:3457. For saved repositories and
integrations, run `bobs-factory start`. Prepare Git and the selected agent for the
same service account; Cursor additionally needs the separately prepared SDK and
Node described in the distribution guide.

`bobs-factory --help` lists the supported commands:

- `local` (default): start the local repository dashboard.
- `start`: start the configured worker.
- `tui`: open the fullscreen terminal dashboard of a running local factory.
- `self-auth-linear`: authenticate your independent Linear OAuth application.
- `self-add-repo [url] [workspace]`: clone and configure a repository.
- `check-tokens` and `refresh-token`: inspect or refresh Linear credentials.
- `migration inspect`, `preview`, `apply`, `restore`: explicit Cyrus migration helpers.

`--home` overrides `BOBS_FACTORY_HOME`, then defaults to `~/.bobs-factory`.
`--env-file` defaults to `<home>/.env`; existing process environment values win.
Home is selected before env loading. See [configuration](../../docs/CONFIG_FILE.md),
[self-hosting](../../docs/SELF_HOSTING.md), and the
[migration assistant guide](../../skills/bobs-factory-migrate/SKILL.md).

`BOBS_FACTORY_HOST_EXTERNAL=true` exposes the webhook listener on all interfaces.
The dashboard remains loopback-only; webhook ingress does not authorize exposing
it. `LINEAR_ALLOWED_TOOLS` and `DISALLOWED_TOOLS` override the corresponding
configured tool settings. Native Git, SSH/signing and agent stores remain host-owned.
