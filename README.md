# Bob’s Factory

A self-hosted software factory: describe work, answer questions, review the result
and approve delivery from a local dashboard. Bob’s Factory is an Apache-2.0 fork
of [Cyrus](https://github.com/cyrusagents/cyrus) by Ceedar. Original notices and
historical changelogs/test drives are retained.

## Install and start

Binary distribution is being validated for macOS ARM64/x64 and Linux ARM64/x64
(glibc). Windows and automatic updates are deferred. Use an explicitly versioned
archive and its matching manifest from the project's releases. Until a verified
release is published, use the development checkout below.

Install Git and prepare/authenticate the coding agents you want to use. The
factory executable needs no separately installed Node, npm or Bun. An agent
installed through npm may require Node for its own launcher. Cursor needs a
[separately prepared SDK and Node](docs/distribution/README.md#prepared-cursor-installation);
the binary does not bundle Cursor code. Agents/workflows
handle project dependencies during runs. GitHub delivery uses your prepared
`gh` authentication and existing Git/SSH/signing identity.

```sh
./install-binary.sh ARCHIVE.tar.gz ARCHIVE.manifest.json ~/.local
~/.local/bin/bobs-factory --repo ~/code/my-project --agent codex
```

The installer checks target, checksum and archive contents. Add `~/.local/bin`
to PATH. Open http://127.0.0.1:3457, select a workflow, and start a run. Your
repository needs a checked-out branch; delivery needs a writable origin. State
is separate from binaries, under `~/.bobs-factory`.

`bobs-factory --help` lists commands. `--home` overrides `BOBS_FACTORY_HOME`, then
`~/.bobs-factory` is the default. `--env-file` overrides `<home>/.env`. Process
environment values take precedence. Values loaded from the file update on reload;
removing a file-owned key removes its environment value. Home is resolved once before env loading;
an env file cannot change its own selected home.

For configured repositories/integrations use `bobs-factory start`. Local launch
accepts `--repo`, `--port`, `--agent`, `--model` and `--home`. The dashboard stays
loopback-only; webhook ingress uses a separate listener. A public webhook tunnel
is not permission to expose the dashboard. [Self-hosting](docs/SELF_HOSTING.md)
describes independent integration setup and services.

## Workflows and history

Recipes include Simple, Factory and Takeover. Their stable IDs are `simple`,
`factory` and `takeover`. New ticket launches select manual UI/API choice, then
`[workflow=...]` in the original triggering comment, then issue description,
then configured label order, then saved default. Malformed/conflicting selectors
reject; the selected recipe must allow the launch trigger. Replies steer the
existing session and retain its accepted definition. See [Factory docs](docs/FACTORY.md).

The dashboard retains runs, chats, evidence, review decisions and checkpoints.
PWA installation still requires a browser-supported secure origin; a service
worker/version guard cannot make an insecure remote dashboard safe. Every dashboard address requires a passkey session, including localhost.
Configure the exact public HTTPS origin and enroll a passkey using the local
operator setup code; see [passkey setup and recovery](docs/FACTORY.md#passkey-access-and-first-setup).
Current ngrok support remains; zrok2 (#39) and identity configuration (#57) are
separate work.

## Migrate Cyrus

Use the [migration assistant skill](skills/bobs-factory-migrate/SKILL.md) through
your existing assistant. It discovers your installation/service account, previews
changes, coordinates a maintenance window and verifies preservation before
switching services. The helper commands are `migration inspect`, `preview`,
`apply`, and `restore`. They never start services. Existing destinations, hosted
control-plane setup, unknown state and unverified native conversation relocation
block automatic apply. Keep backups and original state until verification passes.
There are no old command aliases or implicit old-home fallback.

## Develop from a checkout

```sh
git clone https://github.com/Attraccess/bobs-factory
cd bobs-factory
pnpm install --frozen-lockfile
pnpm factory --repo ~/code/my-project --agent codex
```

Development/builds use the repository pnpm version and Bun 1.4.2. See
[distribution tooling](docs/distribution/README.md) for build, validation,
manual replacement and rollback. Workspace packages are private; upstream npm
publication is retired. No upstream cloud enrollment is needed or supported.
