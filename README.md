# Bob’s Factory

[Source repository](https://github.com/jappyjan/bobs-factory) ·
[Homepage](https://jappyjan.github.io/bobs-factory/)

A self-hosted software factory: describe work, answer questions, review the result
and approve delivery from a local dashboard. Bob’s Factory derives from the
Apache-2.0 project [Cyrus](https://github.com/cyrusagents/cyrus) by Ceedar. Original notices and
historical changelogs/test drives are retained.

## Install and start

On macOS or Linux (x64/ARM64, glibc), install Bob and launch it:

```sh
curl -fsSL https://jappyjan.github.io/bobs-factory/install.sh | sh
~/.local/bin/bobs-factory
```

The installer selects a verified public release. Before the first stable release,
it selects the latest verified beta and labels it as a prerelease. See
[release availability](https://jappyjan.github.io/bobs-factory/releases/latest.json).
The maintained [downloads page](https://jappyjan.github.io/bobs-factory/downloads/)
lists available and planned installation paths without advertising unpublished packages.

The installer detects your platform, checks the download and installs it under
`~/.local`, preserving earlier versions and your state. It configures PATH for
future terminals; the launch command above also works immediately. No GitHub
account, GitHub CLI, Node, npm or Bun is required to install Bob.

Your browser opens at http://localhost:3457. Create a passkey using the setup
code shown in the same terminal. Bob then helps you choose an existing Git
project and an installed coding agent. Connect GitHub in the browser when you
want to deliver PRs. The GitHub CLI is optional; Bob handles PRs, checks and
merges through GitHub's API.

Git and the coding agent you select need to be installed. An agent may need its
own runtime and login; Bob shows the setup relevant to that agent. Cursor uses a
[separately prepared SDK and Node](docs/distribution/README.md#prepared-cursor-installation).
Project dependencies are handled by the workflow and agent. Keep the terminal
running; [self-hosting](docs/SELF_HOSTING.md) covers background services and
optional ticket/webhook integrations.

After opening a new terminal, `bobs-factory` launches the saved setup. For an
explicit project, use `bobs-factory --repo ~/code/my-project --agent codex`.
`--no-open` leaves the browser closed and prints its address for headless use.
Your project needs a checked-out branch and a writable origin for delivery.

State lives under `~/.bobs-factory`, separate from the executable.
`bobs-factory --help` lists commands. `--home` overrides `BOBS_FACTORY_HOME`, then
`~/.bobs-factory` is the default. `--env-file` overrides `<home>/.env`. Process
environment values take precedence. Values loaded from the file update on reload;
removing a file-owned key removes its environment value. Home is resolved once before env loading;
an env file cannot change its own selected home.

For configured repositories/integrations use `bobs-factory start`. The dashboard
stays loopback-only; webhook ingress uses a separate listener. A public webhook
tunnel is not permission to expose the dashboard. See
[passkey setup and recovery](docs/FACTORY.md#passkey-access-and-first-setup) for
remote access, additional keys and deliberate recovery.

For daily work from another terminal, run `bobs-factory tui` while the factory is
running. Start runs, follow live activity, answer questions, approve reviews and
settle finished work. Use `--theme light` or `--theme dark` to override automatic
theme detection; `t` switches themes, `ctrl-k` finds a run, and `?` shows keys.
Select the running service's `--home` and `--port` when they differ from the defaults.
See [terminal dashboard](docs/FACTORY.md#terminal-dashboard) for access and controls.

## Workflows and history

Recipes include Simple, Factory and Takeover. Their stable IDs are `simple`,
`factory` and `takeover`. New ticket launches select manual UI/API choice, then
`[workflow=...]` in the original triggering comment, then issue description,
then configured label order, then saved default. Malformed/conflicting selectors
reject; the selected recipe must allow the launch trigger. Replies steer the
existing session and retain its accepted definition. See [Factory docs](docs/FACTORY.md).

The dashboard retains runs, chats, evidence, review decisions and checkpoints.
PWA installation still requires a browser-supported secure origin; a service
worker/version guard cannot make an insecure remote dashboard safe. Every browser dashboard address requires a passkey session, including localhost.
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

For development of Bob’s Factory itself, prepare Git, Node 22+, pnpm 10.33.1 and
Bun 1.4.2:

```sh
git clone https://github.com/jappyjan/bobs-factory.git
cd bobs-factory
pnpm install --frozen-lockfile
pnpm factory
```

The development launcher uses the same first-launch setup. An explicit project
can be selected with `pnpm factory --repo ~/code/my-project --agent codex`.
Prepare and authenticate the selected agent through its supported setup.

See [distribution tooling](docs/distribution/README.md) for build, validation,
publication, manual replacement and rollback. Workspace packages are private;
upstream npm publication is retired. No upstream cloud enrollment is needed or supported.

Verified channel publication uses immutable candidates and separate stable/nightly
metadata. Scheduled automation stays disabled until separately authorized rollout;
stable promotion selects an explicit published nightly and requires protected release
approval. See [the public release operations](docs/distribution/PUBLIC_RELEASES.md) for preparation, real evidence,
six-hour nightly eligibility, upload recovery and Pages-only retries.
