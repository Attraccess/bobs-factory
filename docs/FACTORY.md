# Bob’s Factory

The factory builds on Cyrus’s runners, Git worktrees and ticket integrations. Its
dashboard and JSON workflow graph are deliberately small: passkeys and a private
local authentication file, without accounts, a database or a hosted identity service.

## Start locally

Install a verified macOS/Linux binary and prepare Git, `gh` and your selected
agent CLI. Authenticate the agent and GitHub CLI. The repository needs a checked-out
base branch and writable origin for delivery. The factory needs no separate Node,
npm or Bun. See [binary distribution](distribution/README.md) for availability.

```sh
bobs-factory --repo /absolute/path/to/repo --agent codex --model gpt-6.1-sol
```

Open http://127.0.0.1:3457. `--port`, `--home` and `--agent` are optional;
defaults are 3457, `~/.bobs-factory` and `claude`. Local launch uses the next port
for RPC/webhooks and works without Linear credentials for manually triggered tasks.

`bobs-factory start` uses configured repositories/integrations and starts the
dashboard on port 3457. Set `BOBS_FACTORY_FACTORY_PORT` to choose another port,
or `0` to disable it. Development checkouts can still use `pnpm factory`.
The dashboard binds to loopback separately from the webhook listener and is
intended for one operator. Every dashboard address requires a passkey session,
including localhost. Provider webhooks and OAuth callbacks stay independent of
dashboard authentication.

## Passkey access and first setup

Factory requires a server-verified passkey session for all dashboard data and
controls. Localhost has no authentication bypass. An empty store displays the
first-passkey setup screen; it does not give a remote visitor permission to enroll.
Development checkouts use Node 22 or newer (SimpleWebAuthn 14). The binary includes its runtime.

For an HTTPS tunnel, configure the exact browser origin before starting Factory:

```sh
bobs-factory --repo /absolute/path/to/repo \
  --origin https://bobs-factory-schlepptop.zrok.apps.janjaap.de
```

Configured services use `BOBS_FACTORY_FACTORY_ORIGIN` for the same setting.
`BOBS_FACTORY_FACTORY_PUBLIC_ORIGIN` remains a compatibility alias; the explicit
`BOBS_FACTORY_FACTORY_ORIGIN` setting takes precedence when both are supplied.
`BOBS_FACTORY_FACTORY_PORT` remains 3457 by default. The server binds only to loopback,
accepts only explicitly configured authorities and checks exact browser Origin
on writes. Request headers and loopback proxy peers never waive authentication.
The tunnel must preserve the public authority and origin. No forwarded header
is used as an authentication or identity claim. There is no extra UI listener.
Remote access is denied when its origin has not been configured.

At first startup, a ten-minute, single-use setup code is written to
`<home>/factory/auth/enroll.json`, readable only by the operator. Copy its `token`
value into the setup screen. Generate another code on the machine when it expires
or a registration is cancelled:

```sh
bobs-factory --home /absolute/path/to/the/effective/factory-home factory-auth
```

An installed CLI also supports `bobs-factory --home /absolute/home factory-auth`
and `bobs-factory --home /absolute/home factory-auth --recover --confirm
"RESET FACTORY AUTHENTICATION"`. Neither command starts services.

Start the server before generating a code: pending grants/challenges are
invalidated on restart. Both launch modes default to `~/.bobs-factory`; `--home` selects another
state directory. Always choose the home used by the running service. Setup codes authorize one enrollment, expire in ten minutes and
never belong in URLs, screenshots, run prompts or ticket comments. Transfer the
code privately to the phone, then open the exact configured HTTPS origin there.

Each passkey belongs to the address where it was created. Localhost and the
public hostname need separate keys. The `http://127.0.0.1:3457` entrypoint redirects
to `http://localhost:3457` because WebAuthn rejects IP addresses as RP IDs.
Both addresses protect data; the redirect provides a usable local login.
`Settings` in the main navigation contains passkey management and sign-out.
The sign-in screen folds new-key setup under `Set up a new passkey` once the
first key exists. First-time setup opens automatically. In Settings, add a named
phone/security key or remove a saved key; each change explicitly verifies an
existing passkey first. Viewing keys also requires verification within the last
five minutes, with a verification button when that window has expired. Keep at least one key per enrolled address;
removing the last key requires local recovery. Removing a key revokes its sessions
and live streams. Labels and metadata are shown; public keys and session tokens
are never returned.

Sessions last twelve hours without sliding renewal. `--session-hours` or
`BOBS_FACTORY_FACTORY_SESSION_HOURS` permits 1–24 hours; the explicit CLI option takes
precedence over the environment, and twelve hours applies only when neither is
set. Invalid values fail startup. Sessions survive a restart;
credentials, counters and token hashes live in private atomic files. HTTPS uses
host-only `__Host-` cookies with Secure, HttpOnly, SameSite=Strict and Path=/.
Loopback HTTP uses a host-only HttpOnly/SameSite=Strict cookie. Both paths require
a verified, unexpired server record. Ceremonies require user verification, exact
origin/RP binding and a single-use browser-bound challenge valid for five minutes.

Sign out warns that unsent edits and review comments will be discarded across
tabs. Expiry/revocation also clears sensitive views and
stops retries, streams and late responses. Reopening, restored navigation and
reconnection recheck the session. Offline access shows an inert sign-in screen.
The service worker caches only the static shell, never auth/API/media responses.
Theme and settled-view preferences are retained.

### Local recovery

If every passkey is lost or the store is corrupt, deliberately reset only Factory
authentication on the machine:

```sh
bobs-factory --home /absolute/path/to/the/effective/factory-home factory-auth \
  --recover --confirm "RESET FACTORY AUTHENTICATION"
```

A running server consumes the private recovery request and revokes every key,
session, stream and pending ceremony. No service restart is required. If corrupt
state prevented startup, rerun the server after recovery. Run history, workflows,
integrations, credentials for provider services and worktrees are preserved.
The old auth file is retained privately as a recovery backup and is never read
automatically. Use the new setup code in `factory/auth/enroll.json`. Corrupt state
and incompatible configured origins fail closed; restore the old configuration
or deliberately recover rather than silently rebinding existing keys.

| Surface | Access |
| --- | --- |
| Local and public dashboard data/actions/media/SSE | Passkey session required |
| Static app shell, version, access status and ceremonies | Public; no run or configuration data |
| First or recovery enrollment | Operator setup code; one key only |
| Additional enrollment/removal | Recently verified session or a fresh operator code |
| Provider webhook/OAuth listener (3456 in production) | Existing provider signature/OAuth checks; independent of dashboard login |

### Rollout and device checks

This change does not deploy, restart or alter production Nix/zrok2 services.
The parent must review the code, configure the reserved HTTPS origin, confirm
that zrok2 preserves authority/Origin and retire the legacy localhost-rewriting
proxy before public rollout. The UI tunnel can keep target `127.0.0.1:3457`;
authentication applies even to rewritten localhost requests. Verify signed
Linear deliveries, rejection of unsigned deliveries and OAuth callback access
on the separate provider listener.

Physical iPhone Safari and installed-PWA validation remains a human check: enroll
at the public HTTPS origin, log out/in, add a second key, revoke it, test expiry
and reopen the installed app. Chromium emulation and a virtual authenticator do
not prove biometric, Safari or synced-phone behavior. Connection failure means
reconnect to sign in; a browser cancellation means retry with a fresh setup code
when enrollment has consumed its previous authorization.

## Execution identities and tools

**Settings** has separate pages for **Access** (passkeys and sign-out), **Execution defaults**, **Identity profiles**, **Tool profiles**, **Instance capacity** and **Run titles**. Recipes manages workflow definitions and launch permissions. In Identity profiles, create an identity with separate Git author/committer, repository account, signing policy and per-runner API references. Create a tool profile with declared MCP sources/definitions, per-server credential references, removals, denials and supported ordinary settings. Enter credential names or protected-file paths, never token values.

The composer selects identity and tools independently and offers an effective preview. Manual choices override repository defaults, which override factory defaults. No selection/default keeps Legacy behavior. Explicit profiles require both concerns and an authentication binding for every workflow provider and the title agent. Unsupported native sources fail before worktree setup. Saved runs keep their accepted definitions even when defaults change or profiles are deleted.

See [execution profiles](FACTORY-EXECUTION.md) for supported CLI versions, clean-project restrictions, API authentication and recovery limits. Profiles do not replace OS sandbox controls. Native subscription login remains available through Legacy and eligible explicit Claude/Codex native-login Share profiles with Share tools.

## Install Bob’s Factory

Open your usual **stable HTTPS factory address** with the factory server running.
Keep using the same origin: changing the hostname or port creates a separate app
and separate browser data. Keep your existing access protections in place.
Installation does not make the factory public or keep its server online.
Loopback addresses also work as secure development contexts.

**Install app** in the header explains the browser’s installation path. When a
browser offers a native install prompt, its install button appears in this help
dialog and prompts only after you click. Dismissing it leaves the browser app
usable. Standalone windows show **App help** instead.

| Browser | Installation path |
| --- | --- |
| Mac Chrome | Address bar install icon, or menu → Cast, save, and share → Install page as app. |
| Mac Brave | Address bar install icon, or menu → Save and Share → Install. |
| Mac Safari | File or Share → Add to Dock; requires macOS Sonoma 14 or later. |
| iPhone Safari | Share → Add to Home Screen; enable Open as Web App when offered. |
| iPhone Brave | Use Add to Home Screen if its menu offers it. Otherwise open the same address in Safari and install there. |
| Android Chrome | Menu → Install and create shortcut → Install; menu wording can vary. |

These paths follow the current [Chrome](https://support.google.com/chrome/answer/9658361),
[Brave](https://support.brave.app/hc/en-us/articles/39077114659597-How-do-I-install-and-use-Web-Apps-in-Brave),
[Safari on Mac](https://support.apple.com/en-ca/104996), and
[iPhone Safari](https://support.apple.com/en-lamr/guide/iphone/iphea86e5236/ios)
guidance. Brave’s iPhone menu availability is conditional; the Safari fallback
is the supported alternative. Ordinary Safari and its installed app may have
different site data; do not assume shared cookies or storage.

To uninstall on Chrome/Brave, use the app’s menu or the browser’s app management
page. Remove Safari’s app from Applications/Dock, or delete the iPhone/Android
Home Screen app. Removing an app does not stop backend runs. Clearing its site
data can also remove reading and layout preferences.

### Disconnection and updates

The service worker bundles maintained Workbox precaching and routing modules
locally; it does not load a CDN or depend on an external app provider. Browser
subresource integrity checks and the server build header validate its allowlist.
After a successful first visit, the service worker caches only the branded
static shell: HTML, versioned JavaScript/CSS, manifest and icons. A cold offline
launch explains how to reconnect instead of loading indefinitely. Run history,
API responses, live events, artifacts, screenshots and raw entries are not
stored in this offline cache. Loss of authenticated access clears private views and unsent edits. The static
sign-in screen remains available offline; nothing is queued or replayed.
Reconnection rechecks access and refreshes configuration and current runs/gates
before actions become available.
Unsupported service workers or failed registration leave the connected app
usable.

Updates are offered explicitly. **Later** keeps the mounted app, drafts and
reading position. If its version differs from the server, actions remain paused
until you update. **Update now** waits for outstanding actions to settle, checks
the complete new shell, then reloads only the tab you chose. Other tabs retain
their UI and receive their own update notice. Installation and frontend updates
do not stop, restart, approve or replace backend runs.

Unsent launch inputs and agent overrides, chat text, clarification answers,
review comments, additional feedback and recipe/settings edits stay only in the
current unchanged form. Leaving the form, changing its questions, recommendations,
review or saved settings context, reloading, reopening a tab or updating the app
discards them. Unchanged refreshes and unrelated activity/capacity updates keep
current typing. Fresh forms use current server settings and declared defaults;
recommendations are still preselected where provided. Typing never sends or saves.
Previously stored drafts and legacy update snapshots are ignored.

Explicit updates preserve only reading/layout state on a best-effort basis:
the selected route, open panels, inspector selection and stable conversation
reading anchors. The view-only snapshot expires after 30 minutes, is bounded at
512,000 characters and is consumed after restoration. It contains no inputs,
query cache, transcript, artifact or screenshot. Denied/full browser storage
cannot postpone an update just to preserve edits. Reading restoration fetches
the relevant bounded history page; if its anchor is no longer retained, the app
explains that limitation.

Guided-review comments remain collected while moving among chapters of the same
active form. Leaving the review or changing its commit, guide, gate or decision
context starts an empty collection. Pending requests remain locked across
navigation, but returning shows fresh inputs. Failures keep text for retry only
in the same unchanged, still-open form. Saved settings, submitted answers,
messages and feedback, run history and pending server work remain on the server.

For damaged browser caches, first copy unsent drafts and reconnect. Try **Retry
connection**, then **Update now**. If that fails, remove this origin’s service
worker and `bobs-factory-shell-*` caches in browser developer tools, then reload
while connected. The browser’s clear-site-data option is a broader reset and
also removes browser preferences. Server run/checkpoint data is separate
and remains intact.

The versioned UI sends `X-Factory-Build` on API requests; mismatched writes are
rejected before execution. Configuration edits/launches also check the fetched
recipe revision, and answers check their question/step context. Existing local
automation without this metadata remains compatible and must still satisfy the
Host, Origin and `X-Factory-Request` guards. Such legacy clients do not gain UI
version protection by omitting the metadata.

### Opt-in notifications

Keep the existing stable HTTPS address and tailnet-only Tailscale Serve deployment.
Set `BOBS_FACTORY_FACTORY_ORIGIN` to that exact HTTPS origin (no path or trailing slash)
when the proxy forwards its public Host or Origin. The listener remains loopback-only;
only configured origins pass the request guards. Push status and device management
require the same passkey session as the dashboard, including on localhost. A
notification opened while signed out keeps its destination and requires sign-in
before refreshing current run or review state. Non-sensitive device consent and
deferred subscription cleanup survive sign-out; private drafts and run caches
are cleared.
No forwarded-header trust, public listener or permissive CORS is added. Do not expose
Factory through a public tunnel to enable push. For explicitly authorized QA, an
isolated fixture may use an authenticated `zrok2` HTTPS tunnel. The
[protected HTTPS QA record](WEB_PUSH_HTTPS_QA.md) verifies browser/API flows through
that tunnel with mocked subscriptions and delivery. Production Tailscale proxy
configuration and native foreground/background receipt remain unverified.

Set `BOBS_FACTORY_FACTORY_PUSH_SUBJECT` to an operator contact, such as
`mailto:operator@example.org` or an HTTPS contact page, then restart Factory.
A configured server creates `<factoryHome>/factory/push.json` with mode `0600`.
It contains the stable VAPID key pair, browser subscriptions and consumed-event
bookkeeping. Back it up securely with Factory state. The subject and keys in
that file remain authoritative on restart; changing the environment variable
alone does not rotate them. Never copy this file into web assets or share it as
an artifact. Repair corrupt or unwritable state before restarting; push disables
itself without discarding the file or interrupting Factory. To rotate keys,
stop Factory, securely archive the file, remove it and restart with a valid
subject. Every device must explicitly enable again; old subscriptions are unusable.

Open **Notifications** beside Install app/App help. **Enable this device** requests
browser permission only from your click and registers the existing app worker.
Give each browser profile or installed app a recognizable label. Enabled means
both browser subscription and server registration succeeded. **Send test** uses
the same encrypted VAPID/provider/worker path as real events. Check your device
for the visible notification: provider acceptance alone does not prove receipt
or background delivery. Permission, browser support, server configuration and
delivery health are shown separately. Change a label in the input before enabling
an existing subscription. Disable or remove other devices independently; enable
those devices from their own browser. Remote disable requires explicit re-enable
and is never undone by a foreground visit. Local disable unsubscribes immediately;
failed server cleanup is retained locally and retried on foreground/reconnect.
Denied or revoked permission leaves Today and the connected app usable.
Closing Notifications discards unsent label edits; registered device labels and
notification consent remain saved.

Supported events are new question waves or changed question sets, new pending
review revisions, failed/interrupted runs needing help, explicit human-only merge
blockers, and successful completion including runs without a review guide.
Mirrored native sessions are suppressed when a Factory run exists. User stops,
automatic restart recovery, tool activity, capacity waits and CI/merge polling do
not alert. Closely spaced events for one run coalesce; unchanged questions/gates
and repeated saves never alert again. Notifications show Factory's name and a
fixed event type, never ticket titles, question text, findings, transcripts or
raw errors. Clicks focus an existing app tab or open the relevant run/review hash
route and refresh authoritative state before actions. Navigating to another
form discards unsent edits, following the dashboard's normal form behavior.
Protected links still require tailnet access and the existing access controls.

Delivery is intentionally **at most one attempt**, with no recovery backlog.
Existing attention at startup, registration or re-enable becomes a baseline.
Claims are saved before sending; a crash near dispatch can lose an alert.
Transient failures consume the event and apply bounded backoff; events during
backoff are skipped. Only a fresh event after backoff or an explicit test checks
recovery. Provider HTTP 404/410 removes an expired subscription; authentication
errors and rate limits retain it with separate delivery health. Receipts are
bounded. Tests are limited to one per device every 30 seconds; there are at most
32 devices. Provider TTL is **0**, so an unreachable device may miss an event
rather than receive stale attention when it reconnects. This is neither guaranteed
nor offline delivery. [Web Push protocol](https://www.rfc-editor.org/rfc/rfc8030#section-5.2).

Factory must be running with outbound HTTPS to browser push services; no new inbound
callback is required. The maintained [web-push library](https://github.com/web-push-libs/web-push)
handles encryption and VAPID; endpoint validation permits Google FCM, Mozilla and
Apple services, rejects local/private/tailnet DNS results and does not follow
redirects. Apple documents allowing `*.push.apple.com` on outbound networks.
[WebKit iOS guidance](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

Browser guidance checked 2026-10-07:

- Desktop Chrome and Android Chrome use standard PushManager subscriptions and
  visible notifications. Feature detection controls availability.
  [Google guidance](https://codelabs.developers.google.com/codelabs/push-notifications).
- Desktop Safari supports standard Web Push. Browser and OS notification settings
  still govern delivery. [WebKit](https://webkit.org/blog/12945/meet-web-push/).
- iOS/iPadOS 16.4+ requires a Home Screen web app and direct interaction for
  permission. Install this same protected address and open the Home Screen app.
  [WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).
- Desktop Brave may require enabling its Google-services push setting.
  [Brave privacy settings](https://support.brave.app/hc/en-us/articles/360017989132-How-do-I-change-my-Privacy-Settings).
  Brave iOS background delivery has not been observed in this implementation.
  If its menu lacks Home Screen installation, open the same address in Safari
  and install there. [Brave installation](https://support.brave.app/hc/en-us/articles/39077114659597-How-do-I-install-and-use-Web-Apps-in-Brave).

Physical-device/background delivery on macOS Chrome/Brave/Safari, iPhone
Safari/Brave and Android Chrome remains unverified. Headless Chromium checks,
mobile emulation and deterministic sender receipts do not establish those cases.
Category filters, per-run muting, quiet hours and suppression while viewing a run
remain deferred.

### Installation validation record

The 2026-10-05 isolated F1/browser drive verifies Chromium 154 shell caching,
cold offline launch, mobile layout, reconnect, two-tab update deferral, draft/
inspector/reading restoration and continued execution of a waiting run. Google
Chrome 154.0.8037.97 on this Mac also renders the connected app and registers its
worker. These checks do **not** establish native installation completion.

The user waived native-device installation testing on 2026-10-05. Native
installation/standalone launch through the protected HTTPS origin on Mac Chrome,
Brave and Safari, and iPhone Safari/Brave, has not been verified.
Desktop UI automation was unavailable; no iPhone/iOS version was confirmed.
Installed Brave 154.1.96.61 and Safari 26.6.2 are inventory, not passing test
results. The 390 × 844 screenshot is Chromium emulation, not iPhone evidence.
Android Chrome’s physical-device check is explicitly waived because no test
device is available. See the [scoped F1 report](../apps/f1/test-drives/2026-10-05-factory-pwa.md)
for exact assertions and limits, including the Workbox follow-up drive.

## Run and configure

The React dashboard uses TanStack Query for cached requests and mutations, Radix for
accessible dialogs/menus, and Tailwind with the RainbowBob theme. **Today** puts
launching, questions, stuck runs and human reviews first; running work stays in
compact rows and finished work moves into **Settled**. Light/Dark/System themes,
mobile layouts and keyboard shortcuts are available from the sticky header.

Open a run for artifacts and step conversations. Human replies appear on the
right, tools share expandable summaries, and CI polling becomes one status.
Real Markdown, decision records, diffs, provider discussion, screenshots and
review recaps render in the artifact inspector; Raw JSON stays available. Large
artifacts load on demand. Conversations fetch 120 records at a time, virtualize visible rows, and retain a reloadable window of at most 600 records / 2 MiB per open step. Collapsed histories unmount; reading positions and disclosures remain cached. Large raw tool records load only when opened. Screenshot galleries virtualize rows, images load near the viewport, and adjacent small artifacts/images are prefetched unless data saving is enabled. Full JSON remains available explicitly; large Markdown renders in bounded pages. Reading positions, open panels and selected cards survive live updates. Typed fields survive unchanged refreshes only within their current form. A reconnecting SSE connection sends coalesced run/configuration notifications; the UI fetches only changed visible data and refreshes after reconnect or returning from the background. Scroll away from the latest message to
pause following; **Scroll to latest** resumes it. Inspector Escape returns focus
and screenshot Escape returns to the gallery first.

**Simple / Bob’s Factory** exposes a **Message Bob** composer below its conversation.
Send questions or instructions while Claude/Codex is working; after completion,
a message resumes the same native conversation and worktree. Successful submissions
appear as your chat bubbles and remain available after restart. Failed submissions
retain text only in the current unchanged form. Use ⌘ / Ctrl + Enter to send; Enter adds a newline.

Slack and Zulip sessions listed in the dashboard use the same composer and
feedback controls. Send remains available while capacity is full or a continuation
is being prepared. Accepted messages show **Queued · will be processed later**
until their turn is admitted. Additional dashboard messages are saved on the server, batched
in submission order after the current turn, and restored after restart. Stop
cancels those pending messages. Completed chats continue through their platform handler,
preserving the native conversation, workspace and title across restart. If a
chat needs a new workflow instead, its follow-up uses the default repository
available when the chat was created.

In **Recipes**, enable **Chat steering** for other workflows, or set `"chat": true`
in their JSON. Chat defaults off for custom workflows. An agent step can set
`"chat": false` to prevent steering or `"chat": true` to opt in independently.
Nested workflows inherit the caller's setting unless they specify their own.
For example:

```json
{
  "id": "interactive-inspection",
  "name": "Interactive inspection",
  "chat": true,
  "steps": [
    { "id": "inspect", "name": "Inspect", "type": "agent", "prompt": "Inspect the requested change; answer follow-up questions.", "json": false },
    { "id": "review", "name": "Review", "type": "agent", "prompt": "Review the result.", "chat": false }
  ]
}
```

Messages target the current agent role. The composer explains when sending is
unavailable: scripts/tools, multiple parallel agents, starting/finishing turns,
unsupported streaming runners, and explicit clarification/review/recovery gates.
Use those gates' existing controls; chat never approves a PR. Runners without
streaming input can still receive follow-ups once a Bob’s Factory session completes.
Completed multi-step workflows retain their existing **Follow-up** action, which
starts a new run; chat does not reopen completed pipeline steps.
Existing runs retain their saved chat setting; old Cyrus runs gain the default
unless explicitly disabled.

Select a repository and workflow in the composer, then fill its launch fields.
**Simple / Bob’s Factory** retains the existing Bob’s Factory execution path and is the initial
default. **Software factory** adds the pipeline
below. Apply `workflow:factory` (or `factory`) to a ticket to select it.
Custom workflow labels are configurable. New launches use an explicit manual
UI/API choice, then a `[workflow=<id>]` selector in the original triggering
comment, then the issue description, then the first matching workflow in
configured label order, then the saved default. Agent/model labels still choose
the run defaults. Workflow selection is independent of repository routing.

In **Recipes**, choose the **Default** pill on the recipe you want.
This choice is saved across restarts, applies to new runs without matching
labels, and is preselected in the composer only when it allows manual starts. You can save any existing workflow as the default;
choose another default before deleting the current one. Existing runs retain
their workflow.

## Launch permissions and origin

Assign an issue with `[workflow=factory]` in its description to Bob, or mention
Bob in a new comment containing `[workflow=takeover]` and your additional
instructions. The original comment overrides the description; historical
comments never select a workflow. Both plain brackets and escaped brackets
(`\[workflow=factory\]`) work, with case-insensitive `workflow` keys and exact IDs.
Selectors in Markdown blockquotes, fenced/indented code, inline code, or paired
single/double/curly quotation marks are examples and are ignored. Quotes must
close on the same line and begin outside a word, so apostrophes in normal prose
are preserved. Repeated identical selectors are allowed. Distinct selectors or
malformed attempts in the winning source reject visibly; lower-priority conflicts
cannot invalidate a higher-priority choice. Unknown or disallowed selections do
not fall back to another workflow. Correct the selector, label, saved default or
**ticket-assignment** permission in Recipes before starting a new session.

Only one launch may own a provider/workspace/issue identity at a time, including
repository-choice, dependency, clarification, review and recovery waits. New
mentions on active issues reject with the active run ID. This is a temporary
policy until [#36](https://taskbot.apps.janjaap.de/p/bobs-factory/t/36) adds
configurable parallelism and fallback routing. Native session/activity receipts
survive restart and completion, so webhook redelivery cannot create another run.
A later distinct session can launch after completion or explicit stop. Interrupted
startup without a saved session retains ownership; send stop to settle it before
launching again. Repository and runner/model selection keep their existing rules.

Replies, blocker answers, stop and resume use the accepted workflow and origin;
reply selectors do not launch replacement work. Replies target their native
session. Ambiguous issue-only replies require the specific run's UI. Chat uses
the accepted recipe settings and streaming runner capabilities; ordinary replies
cannot approve human review. Delivery without native source identity or to an
unsupported checkpoint explains the limitation in Linear. An interrupted reply
receipt is retained to avoid applying an answer twice; inspect the run and resend
as a new reply if needed. Comments and attachment manifests include every page.

Each saved workflow exposes an `allowedTriggers` array. In **Recipes → Launch
methods**, edit **Called by another workflow** (`workflow`), **Start manually**
(`manual`), and **Start from a Linear ticket** (`ticket-assignment`) independently.
The ticket permission covers both assignments and @mentions. Simple has no graph
and cannot grant `workflow`; clone it under another ID with steps to customize.
An empty array disables all new launches. Permission edits are saved atomically;
a referenced child's call permission cannot be disabled while a parent calls it,
including in fanout. A failed save leaves the previous configuration intact.

| Stock or legacy definition without permissions | Normalized permissions |
| --- | --- |
| Simple / Bob’s Factory | `manual`, `ticket-assignment` |
| Public stock/custom workflow | `workflow`, `manual`, `ticket-assignment` |
| Internal/shared workflow | `workflow` |

Explicit arrays (including `[]`) are retained. Legacy arrays and object configs
are normalized on load and saved idempotently, retaining customized roles and
the saved default. Old frozen run definitions normalize from their own saved
flags, independently of current configuration. `internal` remains a shared
presentation and launch-field default; granting a top-level permission explicitly
allows that launch, and operators can add launch fields in JSON if desired.
Factory and Takeover continue calling the same call-only shared pipeline.

Selection is **explicit workflow ID → first matching label in configured workflow
order → single saved default**, preserving existing label case behavior. Check
permission *after* selection. For example, a ticket with `workflow:factory` rejects
if Factory disallows ticket starts even when Simple is eligible. If an unlabeled
ticket's saved default disallows ticket starts, it rejects even when another
recipe is eligible. Enable the selected permission in Recipes, change the
workflow/label, or choose an eligible default; no automatic alternative is used.
Unknown explicit IDs reject. Workflow message selectors are not currently
supported; use the launch methods above. This describes the current product,
and development tasks can request changes to it. Agents evaluate such proposals
against the task's requirements and accepted decisions, within their assigned
role, and update the capability reference when implementing the change. Explicit
planning-only or deferred-implementation restrictions still apply.

Composer only shows recipes allowing manual starts. An ineligible default or
invalidated selected recipe requires choosing an eligible recipe; entered inputs
are retained. With no eligible recipes, Start is disabled and Recipes is linked.
The API and backend enforce the same permission before execution. New follow-ups
require `manual` on Takeover when there is a source, or Factory otherwise.
Answers, feedback, stop, retry and checkpoint resume retain the accepted run;
later permission edits do not strand human waits or replace frozen definitions.

Runs retain `triggerOrigin`: launch type, selected workflow, selection method,
receipt timestamp, and manual composer/API versus follow-up context (including
source run). Ticket receipts retain provider (`linear`, or `cli` for fixtures),
available assignment/mention subtype, workspace/issue/session/comment/activity
IDs, source timestamp and issue URL. Delayed routing or blocking replies do not
replace that original receipt. Original ticket Simple sessions serialize this
metadata too. Called graphs stay in the parent run, with persisted call-start
context and completed history naming the caller workflow, step/key and target.
History and run detail show source links and expandable details across restart.
Historical records without evidence show **Origin unavailable for this older
run** rather than guessed origins. Takeover's existing `source` remains separate.

Both **Composer → Agent settings** and each workflow role include reasoning or
variant controls. Claude/Codex use **Reasoning effort**; OpenCode uses **Model
variant**, including custom provider-defined names. The controls forward to
Claude's SDK `effort`, Codex's `modelReasoningEffort`, and OpenCode's
[`--variant`](https://dev.opencode.ai/docs/cli/#run), respectively. Available
levels depend on the selected model; an empty field preserves the native
default (or inherits a same-provider run setting for a role). Switching a role
to another provider does not inherit the previous provider's effort/variant.
Gemini and Cursor currently use their native model settings; their Cyrus
runners do not expose a separate effort control.

Codex and Claude also offer **Service tier** in run and owned-role settings:
**Default** leaves native configuration untouched, **Standard** explicitly turns
off Fast mode, and **Fast** requests faster processing independently of reasoning
effort. A role inherits a same-provider run tier unless it selects its own tier.
Codex forwards this through `service_tier`; Claude forwards SDK `settings.fastMode`.
Fast availability depends on the model and account and may cost more. Claude
Fast needs a supported Opus model; Claude Code may switch an incompatible model
to Opus. Cursor fast variants use the exact model alias listed by `agent models`,
and OpenCode provider variants remain configurable through **Model variant**.
Gemini CLI does not expose a separate service-tier switch here. Existing runs
keep their saved settings.

**Recipes** also exposes an agent and model field for each agent role, plus the
JSON definition for editing prompts, scripts, tools and graph edges. Empty role
fields inherit the run settings. Changing agent provider without specifying a
model uses that provider's default model. Saved definitions apply to new runs;
an active run retains its original definition.

Explanation requests are kept separately from accepted answers. Bob rephrases the pending decision without restarting the blocked role or advancing the workflow; an explicit answer is still required. Rephrased questions survive restart only while their source questions and recommendations remain unchanged. Changed decisions invalidate the old answer batch. Older rephrasings without saved source context are refreshed once on restart. Explanation turns keep separate revision records, so later fixes still see changes made while waiting. The answer API also accepts `kind: "explanation"` for requests that free-text detection does not recognize.

Clarification pauses until you answer in the dashboard or original agent-session
ticket thread. There is no automatic answer or approval. Decisions and all Q&A
are saved in run history and posted as a comment when a real ticket exists.
Questions include their own brief context, the reason a decision is needed and
the consequences of the choices, so you can answer without reading the step
transcript. Asking Bob to explain or rephrase keeps the decision pending.
Question-enabled roles, including saved and custom recipes, receive this guidance
at execution time. Their question strings support Markdown, small fenced text
diagrams and optional PNG/JPEG images saved in the run's evidence directory.
Use `![caption](/api/runs/RUN_ID/question-images/unique-filename.png)` to display
a local image beside the question; nested paths and external symlink targets
are rejected. Visuals supplement a question that is understandable on its own.

Refinement roles generate evidence-based suggestions alongside string questions:

```json
{"questions":["Which approach should we use?"],"questionRecommendations":[{"questionIndex":0,"answer":"Use the existing approach.","reason":"It meets the requirement without a migration."}]}
```

Recommendation indices are zero-based and unique within the batch. Answers and
reasons must be nonblank. Missing facts, credentials or access must be requested
instead of invented; omit recommendations where no supported choice exists.
Custom and frozen question-enabled recipes receive these instructions at execution.
Legacy results without metadata continue to show blank answer fields.

“Use recommendation” is selected by default. “Custom answer” focuses a separate
empty field, and switching back and forth preserves the custom draft. Mixed
answers submit together. Blank custom answers prevent submission. **Send answers
is always required**: generating, selecting, refreshing or restoring suggestions
never advances work. Ticket replies also require an explicit answer.
Answer choices and custom text reset when leaving the form, changing the
questions or recommendations, reloading or updating. Within the unchanged form,
switching answer modes retains custom text. Contextual API submissions reject
outdated batch IDs, even when the question wording repeats.
Changed questions or recommendations also generate a new originating-ticket
notification. Unchanged waits retain notification deduplication across restarts,
including saved receipts from older versions.
Restart retains unchanged visual-review assistance questions and their batch ID,
so explicitly submitted answers remain usable without sending another question
notification.

The factory runs clarification → decisions → planner/plan-review loop →
implementation → push/draft PR → requirement inventory → specialist review/fix loop → CI/fix loop → QA story and screenshot
plan → QA execution/screenshot review/fix loop → human review guide. The implementer
receives only the accepted plan and its asset references. Reviews retain earlier
findings and fixer dispositions, use stable finding IDs, discard severity 1,
and allow evidence-based rejection and review of that rejection. Visual and CI
fixes return through code review and CI. A CI assessment that leaves the accepted code and base unchanged returns directly to readiness, verified by Git and saved review provenance. New complaints/rejections still receive review; skipping a comment-only round requires an explicit informational-only assessment. Transient provider transport errors retry in the watcher; recognizable link/build notices do not trigger a fixer, and edited feedback is assessed again. The guide now pauses at an explicit human review gate. **Approve & settle**
authorizes only its displayed commit; **Open diff** opens the provider in another
tab; **Request changes** records instructions, runs the fixer and repeats code,
readiness and QA/screenshot review before a new guide and fresh approval. Approval marks
the PR ready, honors required reviews/checks/threads/conflicts/rules, enters a
required merge queue or merges normally, and completes only after GitHub confirms
the merge. No administrator bypass is used. Changed/unpublished revisions and
new provider comments return through fixes and review. Draft status and external
reviewer approvals remain visible human actions without preventing the guide.
Human decisions, review IDs, commit IDs and checkpoint state persist on restart.

Repeated agents start with `/progress` through factory-context: their previous
result, prior/current revision, changed files/diff and new history. Planning and
reviews preserve decisions, stable findings and dispositions while assessing new
feedback and affected code. The default history view is compact: `/history` and
`/progress/newHistory` contain step indexes with references to original outputs.
Reviewers and fixers read `/contextMemory/reviewLedger` and
`/contextMemory/reviewRounds` for distinct verbatim claims, review reasoning and
gate outcomes, then fetch original evidence only where needed. Repeated claims
retain their first/latest round and source paths, so reopened complaints remain
visible. A claimed fix never becomes reviewer acceptance through compaction.
QA scope keeps the cumulative story/criterion and area/state lists.
Capture can reuse real, previously approved images only when their revision is
unchanged or declared dependencies are unchanged and all changed files are
accounted for. Image hashes and dependency provenance are persisted; dirty,
uncertain, changed or unapproved evidence must be recaptured. Otherwise only the
changed areas need a dev server/capture, with subagents where supported. Visual
review retains accepted unchanged evidence; the recap updates changed sections
and can use a short revision summary for a verified minor correction. Every new
human review still requires an explicit decision.

Visual capture requires browser/screenshot tools available to the selected
agent through its CLI or existing Bob’s Factory MCP configuration. Captures must be
real PNG/JPEG files in the supplied evidence directory and cover every requested
area/state. In the factory pipeline, missing capture evidence pauses at the
visual gate with a question explaining the unavailable states and their causes.
Resolve the access, tooling or application setup and answer in the dashboard or
ticket. The same run retries capture and visual review, reusing verified accepted
screenshots when their provenance still matches. Repeated blockers wait for another
answer; an answer never waives missing evidence or approves the PR. This checkpoint
survives restart. The dashboard displays those images and a guide organized around the goal,
before/after behavior, requirements, checks, risks and human review instructions,
inspired by Rocky's visual recap.

## QA and screenshot roles

New stock Factory and Takeover recipes use the versioned `qa-v1` contract while
keeping the existing scope/capture/review/gate/fix step IDs and screenshot URLs.
QA runs for all changed behavior, including API and CLI changes with zero images.
The scope role plans stable stories traced to accepted requirements, decisions
and recorded expectations. Each story has fixtures, ordered actions, observable
criteria, execution instructions and explicit representative screenshot tasks.
A change without executable behavior needs a concrete not-applicable rationale.

The QA role executes the stories with browser, HTTP, CLI or relevant tests and
records expected/observed outcomes and actual check receipts per criterion.
It assesses applicable navigation, feedback, readability and error recovery,
and captures selected states while navigating those flows. It cannot repair
product code. Consequential failures become stable severity 2/3 findings;
optional improvement observations remain visible and nonblocking.

The reviewer checks coverage and real executed evidence, then opens the actual
selected images. The gate independently rejects failed, missing, blocked or
stale criteria even if the reviewer reports no findings. Product failures return
through fixes, code review, CI, QA planning, execution and review. Failed criteria
must be retested before the human guide. QA execution is conservative: every
criterion is freshly executed on repeats; permission to reuse an image never
establishes a behavioral pass.

Missing access, fixtures, tooling or required images waits for assistance at the
same durable checkpoint. Answers retry QA and screenshot review, including after
restart, retaining completed work, findings and provenance-eligible images.
Answers cannot waive testing or approve the PR. Custom recipes need the supported
`capture → visual-review → visual-gate` recovery path; unsupported graphs fail
with a configuration error instead of routing access failures into product edits.
The dashboard shows criterion outcomes, execution receipts, blocked reasons,
findings and optional observations alongside the gallery. The complete human
guide maps actual story evidence to requirements and discloses limitations.

Recognized stock saved recipes upgrade coherently and idempotently, preserving
runner/model choices. Customized affected prompts or routes remain unchanged.
To opt a custom recipe into QA, copy the stock QA roles, `qaContract` markers and
routes together, then reapply custom instructions without removing contract
fields. Already-running recipes stay frozen; legacy screenshot-only evidence
remains readable and resumable and is never presented as completed QA.

## Visual evidence budgets

Visual scope selects individually named representative states, normally 1–2 per
changed area and at most 24 final screenshots. It must not multiply viewport,
language, permission and error-state combinations. Distinct changed layouts or
high-risk rendering justify additional captures; logic/permissions use test
receipts. An unusually broad change may declare `captureBudget` up to 48 with a
concrete `budgetReason`. The runtime validates the selected count and rejects
duplicate states/images in new budgeted inventories.

The visual reviewer returns `acceptedScreenshots` receipts with each inspected
area/state/image hash. These accepted images can survive a partial visual failure
when their dependencies and content remain unchanged. Missing or unverified
critical evidence still blocks the visual gate. Existing in-flight legacy
inventories are retained for safe recovery; the next visual-scope visit uses the
compact contract.

### Authentic demonstration videos

New stock Factory and Takeover runs opt into `video-v1`. QA scope selects up to
three demonstrations linked to existing story/criterion IDs, independently of
visual changes. Usually one 30–90 second clip explains the main changed flow.
Backend-only changes can select none with a concrete reason. Short authentic
flows need no padding. Screenshots and fresh behavioral checks remain required
where applicable; slideshows cannot substitute for recordings.

The capture role checks the local recorder, browser, encoder and metadata probe.
Use the existing server, seeded non-sensitive fixtures, readable pacing and a
fresh explicitly headless session. Prefer `agent-browser --headed false --session
<unique-run-session> open <url>` and its `record start`/`record stop` commands.
Installed Playwright can record with `headless: true` and `recordVideo`; close
its context before awaiting `video.saveAs()`. Never attach to the user's browser,
open desktop windows or silently install global tools. See
[Playwright recording](https://playwright.dev/docs/videos) and
[export completion](https://playwright.dev/docs/api/class-video).

Export MP4/H.264 with yuv420p and fast-start layout where possible; WebM with
VP8/VP9/AV1 is also accepted, with actual container/codec metadata. Produce a real
poster and a transcript of visible steps/outcomes. Audio needs timed WebVTT
captions. Runtime validation requires local `ffprobe` and `ffmpeg`, decodes the
file and streams its hash, and rejects escaped paths, external symlinks,
unsupported/truncated media or exceeded limits. Agent-supplied metadata cannot
establish validation. Missing tools/export failures stay visible limitations for
optional demonstrations; accepted requirements explicitly requiring recording
remain blocked. Product failures are actionable failed QA.

Reviewers must inspect actual playback to return exact task/hash acceptance
receipts. Reuse requires that receipt, unchanged media/poster/captions, task and
linked QA story definitions (including preconditions, fixtures, actions and
expected criteria), source dependencies and fixture/environment assumptions.
Dirty, uncertain or unexplained shared changes require recapture. Runtime retains
the original capture revision and separately stamps the revision validating
reuse; fresh behavioral execution still runs on each visit. Legacy persisted
outputs default to no video. Older task-only validation receipts require fresh
recordings because they cannot establish unchanged scenarios. Frozen runs keep
their definitions; only coherent stock recipes migrate automatically, preserving
runner/model choices. Custom
recipes opt in explicitly using `videoContract: "video-v1"` across scope, capture,
review, gate, guide and handoff.

Guides reference accepted task IDs and hashes. Chapters and inspector show lazy
posters, native controls, inline mobile playback and transcripts. Media loads only
when opened, with `preload="none"` and no autoplay. Playback never checks review
items or approves the PR. Unsupported, stale, expired or missing recordings fall
back to transcripts. Chromium mobile emulation does not establish native iOS
compatibility; record any native testing gap honestly.

Only the validated loopback UI serves `/api/runs/:id/videos/:task/:asset?v=<hash>`
(`media`, `poster`, `captions`). It supports HEAD and single explicit, open-ended
or suffix byte ranges, streams without whole-file buffering, returns 416 for
invalid/multiple ranges and 409 for changed bytes or stale revisions. API media
is `no-store` and stays outside the service-worker shell cache and webhook tunnel.

Limits are three clips, **120 seconds and 50 MiB per finalized clip**, with a
**512 MiB evidence budget per run**. Keep binaries outside source control. Remove
failed temporary exports owned by the capture attempt. Bounded startup maintenance
prunes unreferenced `video-temp-*` files older than 24 hours in terminal runs;
finalized video/poster/caption assets from current and historical capture rounds
expire 30 days after completed/stopped runs. Each pass removes at most 200 files;
missing or already removed files do not consume that budget, so later restarts
continue cleanup across runs while retaining metadata.
Active, waiting, failed and interrupted runs retain evidence for review/recovery.
Metadata and receipts survive cleanup and the UI reports expired assets. Cleanup
never runs on playback requests or deletes files outside the run evidence root.

## Take over existing work

Select **Take over existing work** in the composer and supply an open GitHub PR URL
or a Linear ticket identifier/URL. That source is all you need: requirements
come from the ticket or PR, and the title agent uses that context to name the run.
**Additional instructions** is
optional. For ticket assignment, use `workflow:takeover` or `takeover`; the assigned
ticket is the source. Manual ticket takeover needs that repository's configured
ticket integration (the standalone launcher only has its local test tracker).
The source field accepts ticket IDs/URLs or GitHub PR URLs, not task descriptions.
Invalid sources stay in the launch form with an error before a run is created.
Use Software factory for a new task without an existing ticket/PR.

Takeover preserves an existing local branch/worktree, including unfinished work.
When the PR branch is absent locally it starts from the PR's current remote head.
It snapshots the PR body, all comments, reviews and inline review comments,
then assesses completed work, remaining work and risks. A ticket source captures
all ticket comments, metadata and attachment links and finds an open PR for its existing branch.
The assessment feeds clarification and planning; the implementer receives only
the resulting continuation plan/assets. Publication updates the original PR.
Existing ready PRs are converted to draft while the factory processes them.

The MVP supports open PRs in the selected GitHub repository; fork PRs are rejected.
It never resets an existing branch or force-pushes it. If another factory run owns
the worktree, terminate that run first. Diverged local/remote work fails visibly
at push and needs a human decision.

After resolving a failed step's cause, select **Retry failed step** in the run
view. It keeps the same run, worktree, frozen workflow, answers and history,
and continues from saved progress. Completed steps are skipped; an unfinished
script/tool step runs again, so check any external effects before retrying.
An existing run failed at the visual gate for missing evidence opens the capture
assistance checkpoint on Retry. Its frozen recipe must contain the standard
`capture` → `visual-review` → visual-gate path in the same graph; unsupported
custom graphs fail with instructions rather than skipping required review.
An exhausted iteration limit shows **Continue (+4 passes)**. Each explicit continuation grants four additional visits only to the exhausted step, including nested workflows; historical counters and finished steps remain intact. If those additional visits are exhausted, the run stops again rather than looping indefinitely. The limit counts cumulative visits, including returns after real code/visual corrections. Stock coordination tools (review gates, readiness and routing) have a bounded 100-visit ceiling so they do not immediately block an authorized extra agent pass; customized limits are retained.

Completed or explicitly terminated runs cannot be retried. Publication uses a
short conventional commit message (`chore: …`) derived from the ticket title,
with the repository's Git hooks and signing configuration still enabled.

## Automatic run titles

**Settings → Run titles** configures one global title agent using the existing
provider authentication. Choose a fast, inexpensive provider/model independently
of run, repository and recipe execution settings. Leaving the agent or model
empty uses the global runner or that provider's global default model. Provider
changes clear incompatible settings; saved choices apply to subsequent jobs.

Every new root run starts with its exact run ID as its display title. A separate
agent generates a short title concurrently with execution, using initial task,
source/ticket context, custom inputs and follow-up feedback. Project `.mcp.json`
servers (or `.cursor/mcp.json` for Cursor) remain available in the isolated title
job. Stdio servers keep the source worktree as their working directory, so
relative scripts and data paths work. Explicit platform or repository
configuration retains its normal precedence. Configured MCP tools
can retrieve missing context, including tasks supplied only as a ticket URL.
The dashboard updates lists and details live. Generation respects the session
limit and primary execution has priority; under a one-session cap naming waits
for capacity. A completed run can still receive its title.

Naming failures or a 60-second generation deadline retain the run ID without
failing execution. Explicit stop cancels naming; shutdown preserves pending jobs
for restart. Successful titles survive restart. Historical runs retain their
names, and retrying, answering or continuing a run does not regenerate its title.
New follow-up runs receive their own titles and explicitly reference their source
run. Equal titles do not imply that unrelated runs replace one another.

Custom title fields have been removed from launch forms. Legacy request titles
are ignored, and title editing is deferred to future work.

## Workflow definition

### Launch fields

Edit a workflow's `launchFields` in **Recipes → Edit as JSON** to customize
the composer. Only fields belonging to the selected parent workflow appear;
calling a shared workflow does not add its fields. Repository, workflow and
agent settings are common controls. For example:

```json
"launchFields": [
  {"name":"target","label":"App to deploy","required":true,"placeholder":"Customer portal"},
  {"name":"environment","label":"Environment","type":"select","required":true,"defaultValue":"staging","options":[{"value":"staging","label":"Staging"},{"value":"production","label":"Production"}]},
  {"name":"prompt","label":"Additional instructions","type":"textarea","description":"Anything else the agent should know?"}
]
```

Supported types are `text` (default), `textarea` and `select`. Fields are optional
unless `required: true`; labels, placeholders, descriptions and defaults are
configurable. Names must be unique and start with a letter; runner/repository
control names are reserved. The API validates required values and choices before
starting any work. `prompt` and `source` map to task instructions and Takeover
source; `title` is reserved for automatic naming and cannot be a launch field;
other names become custom inputs. Takeover
always needs a source even if you remove its field. Simple and Factory use the
task form when `launchFields` is omitted; old Takeover definitions receive
the source/optional-instructions form. Use `[]` for no workflow-specific fields.

Values are saved as `run.launchInputs` and supplied to ordinary agent, script
and tool steps as `input.launchInputs`, including shared child workflows.
Scripts read them from `FACTORY_INPUT_FILE` (or `FACTORY_INPUT` for small inputs);
tool templates can use
`{{input.launchInputs.target}}`. Steps with explicit `inputs` still receive only
their selected outputs, so the implementer retains its plan handoff. Question-enabled
steps also receive the human answers needed to resolve their blockers.
Custom Simple fields are appended to its task prompt because it uses Cyrus's
original execution path rather than graph steps.

### Steps and shared sequences

Keep the `simple`, `factory` and `takeover` defaults and add another entry to the JSON array:

```json
{
  "id": "checks",
  "name": "Parallel checks",
  "labels": ["workflow:checks"],
  "steps": [
    {
      "id": "checks",
      "name": "Check in parallel",
      "type": "fanout",
      "groups": [
        [{"id":"types","name":"Types","type":"script","script":"pnpm typecheck","computeIntensive":true}],
        [{"id":"tests","name":"Tests","type":"tool","tool":"exec","computeIntensive":true,"args":["pnpm","test:run"]}]
      ]
    },
    {
      "id": "recap",
      "name": "Summarize",
      "type": "agent",
      "runner": "codex",
      "model": "gpt-6.1-sol",
      "prompt": "Summarize the check results. Return {\"summary\":\"...\"}.",
      "next": "end"
    }
  ]
}
```

Factory and Takeover call the same internal `factory-pipeline` workflow.
Changing its role settings, prompts or steps applies to both parents on new runs.
The settings editor shows only agent steps owned by the selected workflow,
including its own fanout groups. Select **Shared factory pipeline** to configure
its shared roles; parents show their own roles only. Run progress still shows
individual nested steps. Earlier saved flat Factory definitions are upgraded while
preserving customized role settings.

Add a reusable sequence with `"internal": true`, then call it using a step:

```json
{"id":"shared-checks","name":"Run shared checks","type":"workflow","workflow":"checks"}
```

Calls execute the child graph, including loops and fanout, then return to the
parent. They share outputs, original input, launch inputs, human answers and complete history.
Use distinct output IDs across sequences when results must coexist; executing
an ID again replaces its latest output but retains every result in history.
A call returns `{ "workflow": "checks", "completed": true }`. Internal workflows default to call-only permissions but remain editable. Declared permissions are authoritative: deliberately enabling manual or ticket starts makes a shared workflow eligible. Missing
calls, recursion, nesting beyond ten levels and human checkpoints inside fanout
are rejected. All definitions are frozen in each run, so editing a shared child
cannot change an active run.

Steps execute in array order unless `next` or a matching `branches` edge names
another step. `next: "end"` finishes. A branch such as
`{"when":{"path":"approved","equals":false},"next":"plan"}` loops back.
Each step defaults to at most eight visits (`maxVisits`, configurable up to 100).
Agents return JSON unless `json: false`. `inputs: ["plan"]` restricts supplied
context to those output keys (plus `/answers` when `askQuestions: true`);
otherwise agents receive the original input,
launch inputs, outputs, answers and full structured history.

Factory agent roles receive a short role prompt and a private `factory-context`
MCP server. `list_context` browses up to 50 object fields/array entries per page,
including short identity/step previews; `read_context` reads values in pages of
at most 16,000 characters. Both return `nextOffset`; follow it until null to read
each relevant collection/value completely.
Paths use JSON Pointer syntax, for example `/outputs/ticket/comments/0/body`.
Strings use raw text pages; other values use JSON pages. Default `view: "compact"`
replaces historical outputs with indexes and adds deterministic review memory.
Current requirements, decisions, answers, outputs and revision deltas remain
complete. Index `outputPath` references work directly, including existing deep
history paths. Pass `view: "full"` to either tool for original records at the
same paths. Compaction preserves the private source snapshot and persisted
checkpoints; it does not summarize with another model, reset provider
conversations, change iteration limits or grant approval. Only the step's scoped
input is served: `inputs: ["plan"]` exposes `/plan` without ticket/history.
The stock implementer also receives `/answers` and returns `status`, `summary`,
`checks`, and `questions`. A `blocked` status requires at least one actionable
question; the run waits, persists the blocker across restarts, and reruns only
implementation after the answer. `completed` requires an empty question list.
Clarification asks about explicit backlog/planning-only restrictions before
proceeding. PR delivery verifies commits and a nonempty diff against the fetched
base before pushing; an empty implementation cannot advance to GitHub delivery.
Each role/loop/fanout invocation has a separate snapshot, deleted when the role
finishes, fails or is terminated. Persisted run history remains available in the
UI. This works through stdio for the existing runners and needs no additional
port or service. Simple retains its original Cyrus prompt path.

Scripts run with `/bin/sh` in the worktree and receive `FACTORY_INPUT_FILE`
pointing to complete JSON, plus `FACTORY_EVIDENCE_DIR`. The legacy `FACTORY_INPUT`
variable is also available for inputs up to 16,000 bytes; larger contexts use
only the file to avoid OS environment limits. Prefer reading the file:

```sh
node -e 'const fs = require("node:fs"); const input = JSON.parse(fs.readFileSync(process.env.FACTORY_INPUT_FILE, "utf8")); console.log(JSON.stringify({answer: input.answers.at(-1)?.answer}));'
```

The input file is removed after the command exits. JSON stdout becomes the step
output; other stdout is wrapped as `{ "stdout": "..." }`. `exec` uses an
executable/argument array.
Configured MCP tools can run directly:

```json
{
  "id": "tool",
  "name": "Call a configured tool",
  "type": "tool",
  "tool": "mcp__my-server__my_tool",
  "arguments": {"plan":"{{outputs.plan}}","directory":"{{workspace}}"}
}
```

Exact template references preserve JSON types. String interpolation also works
in `exec` arguments. MCP servers come from the existing Bob’s Factory runner config
(stdio, HTTP or SSE). Human checkpoints belong outside fanout groups. Parallel
groups isolate their output dictionaries, but use the same worktree: reserve
fanout for independent/read-only work to avoid file conflicts.

Submitting answers, starting a run and saving workflows show a spinner and a
pending status immediately. Repeat submissions are blocked while the request is
pending. Successful answers show an acceptance message; failed submissions keep
your input available to retry.

## Persistence and MVP limits

Workflow definitions, runs and screenshots are under `<home>/factory`. Runs
retain complete structured step history and up to 1,500 activity events. A
restart automatically restores running and waiting runs after the service starts.
Completed steps are checkpointed, including loop visits, shared workflows and
individual fanout branches. Unanswered clarification stays waiting for your
answer; accepted answers survive restarts. An interrupted agent resumes its
saved provider conversation in the same worktree, with a fresh context MCP
connection. Manual Simple runs and original Linear/CLI ticket sessions use
Bob’s Factory’s existing conversation continuation. Other standalone Bob’s Factory chat/PR
comment sessions are outside factory recovery; use Takeover for existing PRs.
Explicitly terminated, completed and failed runs do not restart. Active runs
saved by earlier factory versions are upgraded using their retained history.
Previously interrupted/stopped historical runs remain unchanged.

An unfinished script or direct tool call is retried from the beginning; use
idempotent commands for steps with external effects. A crash between an external
side effect and saving its result can require the agent to inspect existing
work before continuing. Missing worktrees, repositories or provider transcripts
produce a visible failure instead of silently starting unrelated work. This is
local checkpoint recovery, not exactly-once execution or cross-machine migration.
Termination cancels active runners and script process groups; retained worktrees
and draft PRs stay available for inspection.

Factory delivery currently targets one GitHub repository per run using `gh`.
The Simple path keeps existing multi-repository and platform support. Readiness distinguishes passing CI from a repository with no configured checks;
GitHub must still permit its merge. Loop limits, invalid agent results,
missing screenshots and delivery errors stop with an explicit failure. Human
review remains necessary; an automated green pipeline is evidence, not a
guarantee of flawless software.


## Overnight implementation assumptions (Taskbot #23/#26/#27/#28)

- Use SSE for coalesced progress notifications and TanStack Query for paged,
  cached requests and mutations. Reconnect and refresh after interruptions;
  no hosted service or bidirectional websocket protocol is needed for this MVP.
- GitHub is the merge provider for this MVP. Prefer squash when allowed, then
  merge commits, then rebase; respect GitHub's queue/rules and never force merge.
- Shared workflow models are edited only on their owning recipe. Parent recipes
  show a reference to the shared sequence.
- Settling is presentation state, not authorization to approve/merge a PR.
  Previously completed guides can be settled or followed up; only a new pending
  SHA-bound gate can authorize merge.
- A follow-up on a previously completed run starts a linked-context task using
  Takeover when a ticket/PR exists, otherwise Factory, preserving repository and
  selected agent settings.
- File dependency and image hashes support screenshot reuse; unknown global
  effects require fresh evidence. Brief recap updates never waive fresh approval.

### Instance capacity

Factory and integration/chat sessions in one Bob’s Factory instance use one pool. The default is
four slots, including installations that previously omitted `maxConcurrentSessions`.
Existing numeric settings seed a new pool. Joining workers without a setting adopt
the persisted policy; an explicit conflicting setting is reported in Settings → Instance capacity.
Change **Settings → Instance capacity** to update that instance’s durable limit. Increasing
it admits queued work; decreasing it lets existing execution drain. A deliberate
configuration edit updates the policy, and removing the numeric setting restores
four. Unrelated config reloads and stale startup settings do not reset it.

The coordinator lives at `<factoryHome>/machine-capacity`. Separate `--home`
directories have independent limits and queues, so temporary F1 instances do not
compete with the instance running their parent QA step. Processes using the same
Factory home share its durable policy and restart queue. Repositories and worktrees
within an instance share that instance's pool. `BOBS_FACTORY_CAPACITY_DIRECTORY` no longer
overrides this location. Migration blocks capacity-directory overrides until the
selected pool and its consumers are explicitly reconciled; follow the migration
guide before cutover. The default home retains `~/.bobs-factory/machine-capacity` and
its saved policy. This release requires POSIX
process inspection (`ps`) for reconciliation; unsupported or inaccessible process
inspection fails closed. Existing older worker versions must be upgraded to join.

Agents always use one slot. Script steps and `tool: exec` are intensive by default;
`computeIntensive: false` exempts lightweight commands. Other tools, including custom
MCP calls, are lightweight unless marked `computeIntensive: true`. Recipes exposes
this control for nested fanout branches, and JSON editing preserves it. Classification
on agent/orchestration steps is rejected. Passive CI, handoff, merge and human-review waits
cannot be classified intensive. Setup/teardown scripts also pass through admission.
Normal tool calls within an admitted agent share its slot.
At startup, saved recipes with the formerly allowed intensive handoff flag are
normalized to passive polling, including custom recipes and fanout branches.
Accepted run definitions remain unchanged; their handoff polling consumes no slot.

Parent graphs hold no slot while waiting for fanout or nested steps. Human answer
and review checkpoints and passive CI polling also hold none. Run details show each
active leaf, including **Waiting for capacity**, separately from human questions.
Queued work remains active and stoppable. Ordinary integration/chat sessions report
capacity queueing before the provider has started. Cancelled queue entries never
start, and running/stopping execution remains counted until cleanup has settled.

Primary work is FIFO within the instance. The oldest background title request is admitted
after at most eight primary admissions while it is eligible. Queue identities and
ordering survive restart; graceful shutdown parks recoverable work without recording
user termination. Startup reconciles surviving local descendants before admission.
Completed graph receipts and saved conversations retain their existing recovery
behavior. Queued GitHub/GitLab and Slack/Zulip turns save their prompt, runner,
model and reply routing before admission, then rejoin their original queue position
after restart. Recovery builds configuration for the saved provider, including its
sandbox settings, and GitHub work retains per-PR serialization. Stop remains
available while recovery loads configuration and before execution starts.
Replies use current platform credentials; webhook credentials are
excluded from saved session records. Integration workspace preparation shares the
worker pool even when the CLI supplies a custom workspace handler; stop or
unassignment cancels pending preparation before it can run. Managed Codex
executions use separate app-server processes per lease, so completing one execution
cannot terminate another. Scripts and tools can retry after a crash: external effects still require
idempotency or reconciliation, and execution is not exactly once.

Warm session prewarming and idle streams are disabled for managed workers. After a
completed turn, follow-ups resume the saved native conversation through a fresh gate.
Claude's native AskUserQuestion callback is disabled because it cannot prove all
parallel execution is suspended; questions belong in the final response (Factory
persists its normal human checkpoint). Claude Task/Agent delegation is denied,
OpenCode task permissions are denied, and Codex uses the documented
[`features.multi_agent = false`](https://developers.openai.com/codex/config-reference/)
control. Other harnesses receive the same delegation restriction in their prompt;
that instruction is not a hard enforcement guarantee. Scheduled workflow children
receive their own slots. The cap bounds scheduled executions, not every subprocess,
thread, inference request or arbitrary external program.

Cursor's SDK (in-process in checkout, user-prepared child process in binaries)
and intensive MCP tools cannot prove that all execution
has stopped after an owner crash or an interrupted external call. Their unverified leases remain counted and block
new admission with a visible error; they are not reclaimed by heartbeat expiry.
Reconcile the external execution before repairing its coordinator record. Never delete
coordinator state while participating execution may still be running. Corrupt state,
failed storage writes and unknown process state prevent ungated execution.
### Guided human review

The shared reader opens **Overview → one page per chapter → Changed files → Decide**.
The retained run header, PR links and revision notices stay available. Segments,
Back/Next, the page selector and Up/k or Down/j navigate the guide. Page links use
`?page=overview`, `chapter:<id>`, `files` or `decide` in the hash route. Page,
visited steps, reviewed markers, disclosures and individual checks stay local to
this browser and this exact guide revision. Moving forward marks a chapter read;
jumping or moving back does not. A replacement guide resets progress. Reading
markers never gate approval, and navigation never submits a human decision.

New guide results require purpose-written `tldr` (90 characters maximum) and
`decision.summaryShort` (160). Every chapter requires `tldr` (70), `beforeShort`
and `afterShort` (50 each), `risk: {level: "low" | "medium" | "high", text}` (70),
and 1–3 `keyChecks: [{do, expect}]` pairs (60 characters per field). Fields must
be nonblank; do not truncate full prose into short fields. Existing full summary,
before/after, checks, risks, files, diagrams and evidence remain in More detail.
Incomplete new output is rejected and sent back to the same guide role for bounded
correction. Older saved guides remain readable without migration or invented
compact text or risk levels.

Optional `flow: {title, steps: [{label, detail}]}` reveals one of 2–8 stages at a
time. Newly authored guides declare `scope: {kind: "purely-visual" | "nonvisual",
rationale, files}` from the complete PR diff and accepted requirements. The files
must match the whole-PR inventory exactly. Screenshots alone never establish the
purely visual exemption. Technical, logic, structural, nonvisual supporting and
mixed guides require `system: {lanes, parts, before, after}` with 3–6 meaningful
lanes and nonempty chapter `systemPartIds` for every changed or logic chapter.
Empty connection sets are allowed when truthful. Runtime instructions and
validation apply even to older frozen/custom authoring definitions; saved older
artifacts retain their permissive reading schema. Lanes use `{id, name}`; parts
use `{id, label, laneId, status}` with status
`new`, `changed`, `unchanged` or `legacy`. Connections use `{source, target,
label?, weak?}` and are identified by directed endpoints. Chapter
`systemPartIds` must reference existing parts. Before/After toggles work
independently; route hover or focus highlights relevant parts. Screenshot
references retain accepted area/state/caption, with optional known `device`
(`Desktop`, `Mobile`, `Email`, `Reader`) and `language`. Mixed chapters show
one visual mode at a time. Image and diff dialogs support arrows and Escape.

The page card follows the progress segments directly. On mobile, segments remain
through 14 pages; larger guides use a compact selector. The sticky feedback count
opens the collected comments on Decide, including an empty list. Item comments,
drafts and checks remain available throughout; collected-feedback submission,
additional feedback and page-level PR/diff links live on Decide. Heading focus
moves after navigation with an outline only for keyboard use. Screenshot device
tags use accepted capture context or an honest unknown-device fallback.

Maps use direct curves with separate endpoints, supplied labels and sample legends.
Six lanes fit desktop; narrow screens scroll within the map. Individual apps,
nested plugins, packages and libraries have distinct stable area identities and a
separate palette. Areas owned by one chapter show ONLY THIS STEP.

Changed files loads a runtime-owned, immutable snapshot of the guide’s complete
PR merge-base/head pair. The file inventory and bounded per-file patches live
under run evidence, outside dashboard payloads. Later commits, guide refreshes
or completed runs cannot replace that saved diff. Binary or patches over 2 MB
show an explanation and PR link. Chapter claims group real files; shared files
appear in each group but overall counts include them once. Unassigned files are
shown defensively for old/incomplete guides; new guide coverage still rejects
omitted files. Trees distinguish tests, renames and line counts. Split and unified
diffs preserve hunk numbers, empty lines and no-final-newline markers; long diffs
initially display 500 rows and can reveal the rest. The desktop diff header collects
status, full path, counts, mode, navigation and PR link in one row. Patch content
starts at the first hunk; metadata-only and unavailable changes keep explicit messages.

Historical guides without snapshots reconstruct only from retained CI/readiness
and handoff receipts establishing the original revision. The reconstructed
reference is saved separately from the guide. If exact revisions or patches are
unavailable, the reader says so and offers the PR link. File/image loading errors
remain local to their sections and never alter decision availability.

## Originating tickets and synchronization

For Factory, put a Linear or Taskbot ticket URL on its own line in the manual
prompt, or use `Ticket: https://taskbot.example/p/project/t/77`. Takeover also
accepts Taskbot ticket URLs. An explicit source wins; conflicting source URLs
require clarification. Links inside quotes, code samples, fetched ticket bodies
and historical discussion do not select an origin. Plain prompts still work.

Factory reads the complete ticket before agent work. Registered native trackers
use the ticket's own team states. Taskbot requires one configured HTTP/SSE MCP
transport whose URL matches the ticket instance, with `get_ticket`, `set_status`,
`comment` and `add_attachment` allowed. Project discovery follows the selected
runner: Cursor uses `.cursor/mcp.json`; other runners use `.mcp.json`, then the
configured MCP files and inline servers. An inaccessible explicit source fails
setup visibly instead of silently dropping tracking. Transport credentials stay
in existing configuration; persisted references contain no secrets.

The runtime owns progress comments, PR attachments and lifecycle status. Agents
supply summaries and precise blockers. Work starts In Progress, handoff and human
or provider waits remain In Review, and a coding ticket becomes Done only when
GitHub confirms the PR merged. Run completion, approval, green CI or a merge
queue request alone cannot close it. Closed-unmerged PRs and stopped work remain
open. Simple keeps its native lifecycle. A missing native Review state retains a
nonterminal status and records the limitation in a comment.

Synchronization receipts live on the run as `ticketReference` and `ticketSync`.
Failures appear in run activity and retain pending work across restart. Access
failures retry every 30 seconds while the worker runs; Taskbot status conflicts
require reassessment and do not blindly retry. After restoring configuration or
checking a conflict, call the protected `POST /api/runs/:id/ticket-sync` endpoint.
It retries tracking without replaying implementation, PR publication or merge.
Inspect `ticketSync.error` and receipt limitations in its response. Comments use
stable run/milestone markers; attachments deduplicate by PR URL. Ambiguous writes
are reread before retrying; providers without idempotency cannot guarantee
exactly-once delivery. Terminal tickets are retained for ownership review.

Taskbot comments and status mutations identify `bobs-factory` as author. Its
attachment tool has no author field; the accompanying milestone comment records
attribution using the supported provider contract.


### Specialist review and complete requirement coverage

New stock Factory and Takeover recipes extract requirements after delivery, then run six separately visible agents in `specialist-review.groups`: security/data protection, architecture/module boundaries, repository fit/integration, simplicity/maintainability, correctness/verification, and business requirements/acceptance. The existing machine pool admits these agents as slots become available. Parent fanout consumes no slot. Reviewers inspect and report; corrective work remains outside fanout.

Recipes exposes every role's prompt, runner/model, reasoning and output settings. Edit the JSON to add or remove groups (at most eight), including optional accessibility/interaction, performance/resource use, or deployment/operations specialists. Keep briefs distinct and require concrete evidence rather than subjective preferences. Changing recipes affects later launches; accepted runs retain their frozen definitions and checkpoints.

Agent `reviewContract` values are `inventory-v1`, `specialist-v1`, and `coverage-v1`. They require structured JSON output. Extraction also requires `askQuestions: true` and complete input context. A configured review fanout declares `review: {"inventory":"extract-requirements"}`. Its aggregate `review-gate` tool declares `review: {"inventory":"extract-requirements","fanout":"specialist-review"}`. References name steps in the same graph, including a called workflow's graph. There must be exactly one coverage supplier. Remove that role only after configuring a replacement with `coverage-v1`; its ID, prompt and model are editable. Saving incompatible contracts or removing coverage without replacement fails with an actionable error. Removed roles never run secretly.

Extraction reads original scope, acceptance criteria, complete paginated discussions and assets, clarification answers, accepted plans and decisions, later steering, and applicable takeover/PR discussions. It retains stable IDs, version history, testable criteria, source receipts, suggestions and superseded records. Amendments need a reason; historical records and accepted decisions cannot disappear. Unavailable sources and unresolved conflicts require an outside-fanout question checkpoint. Structural checks do not prove semantic extraction completeness: the extractor must inspect sources.

Before fanout, the runtime freezes one clean head/base revision, inventory version/digest, accepted context, history cutoff and reviewer list. Later steering remains pending for another round. Each output gets its own execution path and runtime revision stamp. Each reviewer checks that the commit is unchanged. Worktree cleanliness is checked after all fanout runners finish and clean up temporary project configuration, then again at the aggregate gate. Remaining tracked or untracked edits invalidate the round, including edits under runner configuration directories. An incomplete, cancelled, failed, malformed or stale reviewer cannot approve. Completed branches survive restart and retry without replay. Substantive fixes, changed scope or uncertain provenance return through extraction; informational feedback may keep the existing unchanged-code/base shortcut.

The coverage supplier assesses every active ID exactly once as `met`, `not_met`, or `deliberately_skipped`, with concrete evidence and a reason. Unmet requirements need actionable rating-2/3 findings. A deliberate skip requires an explicit accepted decision with `kind:"skip"`, its precise `requirementIds`, accepting person, rationale and source. A suggestion, reviewer preference or QA exclusion cannot waive scope. Missing, duplicate and unknown IDs or unsupported skips fail validation.

The gate namespaces findings as `reviewer:local-id`, retains raw rating-1 observations and dispositions, and blocks on open rating-2/3 findings or unresolved disagreements. Fixer dispositions require reassessment. Omitted complaints remain open; settled complaints reopen only with fresh evidence or changed requirements. Removed reviewers' unresolved complaints remain blocking until another configured reviewer supplies an evidence-backed `inheritedDispositions` entry. Disagreement removal requires `disputeResolutions` with evidence and reason.

An unchanged specialist fix that still leaves the same consequential findings open pauses for assistance after reviewer reassessment. Recovery uses the aggregate's frozen revision and namespaced findings, including configured gate names. An answer resumes the existing fixer; findings, coverage, QA and human approval remain blocking until their checks succeed.

QA stories use stable inventory IDs from the configured aggregate, including renamed gate steps. Every active requirement needs a relevant executable story or explicit justified exclusion. Excluding executable QA does not waive the requirement. Failed or blocked required QA still prevents handoff regardless of earlier business coverage. A called workflow returns its review association to its caller; subsequent guides, called QA workflows, fanout branches and approval steps inherit it, including after restart. A branch that establishes its own review retains that association. The human guide uses the frozen active inventory order and runtime-attached coverage; expandable evidence shows accepted skips, specialist attribution, observations, disputes and executed QA receipts. Clean current-head/base checks, screenshots and fresh explicit human approval remain effective.

Untouched legacy stock review segments upgrade conservatively and idempotently for future launches. Customized general reviewers, guide prompts, gate arguments, and consumers of legacy review output keep their legacy contracts. To opt in, copy the extraction/fanout/gate segment from the stock shared pipeline and retarget substantive correction loops through extraction. Preserve your role settings and QA/human approval gates. Active, waiting, failed and restored accepted runs are not rewritten.
