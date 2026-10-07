# Headless browser preference in native QA

Date: 2026-10-07. Tested the uncommitted browser-prompt change based on
`381c85c5ad5d758b98ba0042bdfbc342722e586a`.

## Scope and setup

The change adds headless instructions to generated issue, chat and Factory role
prompts, including self-hosted environments without `CYRUS_BROWSER_USE_ENABLED`.
F1 exercised the changed prompt through a real native Codex Factory QA role.

An isolated repository and bare origin contain a Save-button application and
deterministic accepted requirements/QA scope. A custom `headless-qa` workflow
executes that scope with the stock QA capture role. The native runner uses full
local access for this fixture's Chromium launch. Title generation is disabled in
the fixture; PR publishing, review/merge gates and production runs are outside
this drive. The browser availability environment flag is unset.

Fixture, worker and receipts: `node_modules/.cache/headless-browser-drive/`.
Ports: Factory UI 3640, F1 RPC 3641, application 3642.

```sh
node node_modules/.cache/headless-browser-drive/worker.mjs
CYRUS_PORT=3641 apps/f1/f1 ping
CYRUS_PORT=3641 apps/f1/f1 create-issue --title 'Headless QA browser preference' --description 'Execute the agreed Save story and capture its selected evidence. [workflow=headless-qa]' --labels headless-qa
CYRUS_PORT=3641 apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3641 apps/f1/f1 view-session --session-id session-1 --limit 100
CYRUS_PORT=3641 apps/f1/f1 stop-session --session-id session-1
```

## Results

- Health, issue creation, routing, worktree creation and native session execution
  passed. Tracker activities exposed the native tool actions.
- The agent independently selected `agent-browser`, checked its availability,
  and launched `agent-browser --headed false --session
  qa-def1-save-20261007-2312 open http://127.0.0.1:3642`.
- The agent clicked Save, inspected the resulting snapshot, and asserted the
  visible `Saved record 42` status. The single planned criterion passed with
  actual browser receipts and no findings or unavailable evidence.
- One real PNG was captured. Direct pixel inspection confirmed the heading,
  button and saved confirmation are readable. The image hash matched the runtime
  receipt: `a39cf3e666928de73494091cf8f277324b69767c0070eb9a0aa5278bc28aa131`.
- The runtime stamped clean tested fixture revision
  `6eede49ccedbc281f38fdd99e8c8e19ad9e2acdf`. The workflow completed.
- The agent closed only its named browser session; a session-info check confirmed
  it was inactive. The F1 session and isolated worker/application were stopped.

`verification.json`, `live-run.json`, `final-runs.json`, `activities.txt` and
`worker.log` retain the local execution receipts. The prompt is guidance rather
than an OS-level browser restriction. This drive covers the installed CLI path;
the unavailable-CLI fallback and explicit visible-browser request are covered by
instruction review. Already-running production agents retain their old prompt.

## Targeted checks

- Browser addendum, runner prompt/chat configuration, Factory pipeline and
  workflow runtime suites: 115 tests passed across five files.
- Edge-worker type checking and build passed.
- Changed-file Biome and `git diff --check` passed.
