# Bob’s Factory

[Source repository](https://github.com/jappyjan/bobs-factory) ·
[Homepage](https://jappyjan.github.io/bobs-factory/)

A self-hosted software factory: describe work, answer questions, review the result
and approve delivery from a local dashboard. Bob’s Factory derives from the
Apache-2.0 project [Cyrus](https://github.com/cyrusagents/cyrus) by Ceedar. Original notices and
historical changelogs/test drives are retained.

## Install and start

Verified preview binaries are available for macOS ARM64/x64 and Linux ARM64/x64
(glibc) from [native CI run 37810552203](https://github.com/jappyjan/bobs-factory/actions/runs/37810552203).
All four targets passed their native installer/runtime smoke. The preview is
version `0.2.73`, built from commit `beb6ed76305946fcfab38fa978cb7e3b4e83f6dc`.
Stable release publication is pending; Windows and automatic updates are deferred.

Install Git, the GitHub CLI and prepare/authenticate the coding agents you want
to use. The
factory executable needs no separately installed Node, npm or Bun. An agent
installed through npm may require Node for its own launcher. Cursor needs a
[separately prepared SDK and Node](docs/distribution/README.md#prepared-cursor-installation);
the binary does not bundle Cursor code. Agents/workflows
handle project dependencies during runs. GitHub delivery uses your prepared
`gh` authentication and existing Git/SSH/signing identity.

Choose your target:

| Platform | Target |
| --- | --- |
| macOS, Apple Silicon | `darwin-arm64` |
| macOS, Intel | `darwin-x64` |
| Linux, x64 (glibc) | `linux-x64` |
| Linux, ARM64 (glibc) | `linux-arm64` |

This example uses Apple Silicon and Codex. Change `factory_target` and `--agent`
for your machine and prepared agent. GitHub sign-in is required to download
Actions artifacts. Run the commands in order:

```sh
gh auth login
codex login
factory_target=darwin-arm64
factory_build=beb6ed76305946fcfab38fa978cb7e3b4e83f6dc
factory_archive="bobs-factory-0.2.73-$factory_target"
mkdir -p "$HOME/Downloads/$factory_archive"
cd "$HOME/Downloads/$factory_archive"
gh run download 37810552203 --repo jappyjan/bobs-factory \
  --name "bobs-factory-$factory_target-$factory_build"
gh api -H 'Accept: application/vnd.github.raw+json' \
  "repos/jappyjan/bobs-factory/contents/scripts/install-binary.sh?ref=$factory_build" \
  > install-binary.sh
sh install-binary.sh "$factory_archive.tar.gz" "$factory_archive.manifest.json" ~/.local
export PATH="$HOME/.local/bin:$PATH"
bobs-factory --version
bobs-factory --repo ~/code/my-project --agent codex
```

The installer checks target, archive and executable checksums, and archive contents.
Add `~/.local/bin` to your shell's PATH for future terminals. Replace
`~/code/my-project` with your existing Git project, with a checked-out branch and
writable `origin`. Leave Bob running. In a second terminal, generate a passkey
setup code:

```sh
~/.local/bin/bobs-factory factory-auth
```

Open http://localhost:3457, enter the single-use code and create a passkey. Keep
the code private; it expires in ten minutes. Then select a workflow and start a
run. State is separate from binaries, under `~/.bobs-factory`. Actions artifacts
can expire; keep the downloaded archive and manifest for reinstall/rollback.

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

For development of Bob’s Factory itself:

On macOS or Linux, prepare Git, Node 22+, pnpm 10.33.1, Bun 1.4.2, the GitHub
CLI and your selected coding-agent CLI. This example uses Codex. Authenticate
your tools, then clone and start Bob from its own checkout:

```sh
gh auth login
codex login
git clone https://github.com/jappyjan/bobs-factory.git
cd bobs-factory
pnpm install --frozen-lockfile
pnpm factory --repo ~/code/my-project --agent codex
```

Replace `~/code/my-project` with your existing Git project, with a checked-out
branch and a writable `origin`. Leave the server running. In a second terminal,
from the same Bob’s Factory checkout, generate a passkey setup code:

```sh
bun run scripts/factory.ts factory-auth
```

Open http://localhost:3457, enter the single-use code and create a passkey. Keep
the code private; it expires in ten minutes. Then select a workflow and start
a run. See [passkey setup and recovery](docs/FACTORY.md#passkey-access-and-first-setup)
for other state directories and remote access.

Development/builds use the repository pnpm version and Bun 1.4.2. See
[distribution tooling](docs/distribution/README.md) for build, validation,
manual replacement and rollback. Workspace packages are private; upstream npm
publication is retired. No upstream cloud enrollment is needed or supported.
