---
name: bobs-factory-setup-github
description: Connect GitHub through Bob’s Factory browser setup, or configure an optional GitHub App for webhook mentions.
---

**CRITICAL: Never use `Read`, `Edit`, or `Write` tools on `~/.bobs-factory/.env` or any file inside `~/.bobs-factory/`. Use only `Bash` commands (`grep`, `printf >>`, etc.) to interact with env files — secrets must never be read into the conversation context.**

# Setup GitHub

Bob uses its built-in GitHub API provider for PRs, checks, reviews and merges.
GitHub CLI authentication is an optional existing credential source.

## Part A: Connect GitHub

1. Start `bobs-factory`, enroll or sign in with the operator's passkey, then open
   the guided setup's GitHub connection.
2. Reuse an existing working connection. Otherwise use the browser's classic
   token link, select `repo` scope and an expiration, and submit the token only
   through the protected local form. Classic tokens cover repositories available
   to their account; they cannot be limited to individually selected repositories.
   Fine-grained PATs can lack GitHub Checks access, so do not promise that they
   support full readiness. Setup checks the selected project's PR/CI evidence
   without mutations before saving. Keep the token out of chat, prompts, command
   arguments and screenshots.
3. Confirm the connection shows the intended account after its capability check.
   If GitHub denies an organization repository, authorize the classic token for
   its SSO if required. When organization policy blocks classic tokens, use a
   prepared GitHub App binding; existing App/env/named CLI sources remain valid.
   Preserve the user's existing Git/SSH/signing identity; configure a missing
   commit identity for the chosen repository only after obtaining its values.

Finish when the selected repository can be accessed and Git is prepared. Continue
below only when inbound webhook integration was requested. Outbound PR delivery
works without a GitHub App or webhook setup.

## Part B: GitHub App + Webhooks (Inbound — Optional)

Ask the user:

> **Do you want Bob’s Factory to respond to GitHub @mentions in PR comments and reviews?**
>
> - **Yes — enable @mentions**: Creates a GitHub App so Bob’s Factory can receive PR comments and reviews via webhooks, respond when @mentioned, and act on "changes requested" reviews.
> - **No — PRs only**: Bob’s Factory will create branches, commits, and PRs but won't respond to comments.

If **No** → skip to Completion.

### Step 5: Check Existing Webhook Config

```bash
grep -c '^GITHUB_WEBHOOK_SECRET=.' ~/.bobs-factory/.env 2>/dev/null
grep -c '^GITHUB_APP_ID=.' ~/.bobs-factory/.env 2>/dev/null
grep -c '^GITHUB_APP_INSTALLATION_ID=.' ~/.bobs-factory/.env 2>/dev/null
test -f ~/.bobs-factory/github-app.pem && echo "PEM exists" || echo "PEM missing"
```

If all four checks pass (1, 1, 1, "PEM exists"), skip to Completion — webhooks are already configured.

### Step 6: Collect Inputs

Read the webhook base URL:

```bash
grep '^BOBS_FACTORY_BASE_URL=' ~/.bobs-factory/.env | cut -d= -f2-
```

If `BOBS_FACTORY_BASE_URL` is not set, stop and tell the user to run the endpoint setup step first.

Use the `AGENT_NAME` value from the orchestrator (set in Step 0 of `/bobs-factory-setup`). If not available, ask:

> **What should the GitHub App be named?** (e.g., "Bob’s Factory", "My Code Agent")

**Important — GitHub @mention autocomplete quirk:** GitHub's autocomplete in PR comments only suggests real GitHub *user accounts*, not App bots. This means `@your-bot` won't appear in the autocomplete dropdown unless a GitHub user with that exact name exists. The mention still *works* if typed manually, but for the best experience:

> **Before choosing a name**, check if the same name is available as a GitHub username at `https://github.com/<name>`. If it is:
>
> 1. Create a free GitHub user account with that name
> 2. Invite it to your org and/or repo as a collaborator
> 3. Set `GITHUB_BOT_USERNAME` to that username (the one users will type in @mentions, *not* `<slug>[bot]`)
>
> This is the simplest way to get autocomplete working — a silly GitHub limitation, but the known workaround.
>
> **Without a matching GitHub user**, @mentions still work if typed manually, but won't autocomplete. In that case users would need to set up co-authorship (via a git message template or `prepare-commit-msg` hook adding `Co-authored-by:`) to get the bot's name showing as a repo contributor, which is more involved.

Ask:

> **Where should the GitHub App be created?**
> - **Personal account** (github.com/settings/apps)
> - **Organization** — which org? (github.com/organizations/`<ORG>`/settings/apps)

Store the org name if applicable.

Ask:

> **What homepage URL should the GitHub App use?** This is displayed on the app's settings page as its website. It has no functional impact — GitHub just shows it as a link. Most users use their company website, GitHub org page, or any placeholder URL.
>
> (e.g., `https://github.com/your-org`, your company URL, or just `https://example.com`)

### Step 7: Build Manifest JSON

Construct the manifest, substituting `AGENT_NAME`, `HOMEPAGE_URL`, and `BOBS_FACTORY_BASE_URL`:

```json
{
  "name": "<AGENT_NAME>",
  "url": "<HOMEPAGE_URL>",
  "redirect_url": "http://localhost:8976",
  "hook_attributes": {
    "url": "<BOBS_FACTORY_BASE_URL>/github-webhook",
    "active": true
  },
  "public": false,
  "default_permissions": {
    "actions": "read",
    "checks": "read",
    "contents": "write",
    "issues": "write",
    "pull_requests": "write",
    "repository_hooks": "write",
    "statuses": "read"
  },
  "default_events": [
    "issue_comment",
    "pull_request_review",
    "pull_request_review_comment",
    "repository"
  ]
}
```

**Note:** `redirect_url` is required by GitHub's manifest flow. The actual redirect will include a `?code=` parameter appended to this URL — the code is what matters, not the destination page.

### Step 8: Create GitHub App via Manifest

GitHub's manifest flow works by POSTing a form with a `manifest` field to the app creation URL. After the user approves, GitHub redirects to a URL containing a `code` parameter.

Determine the creation URL:
- Personal: `https://github.com/settings/apps/new`
- Organization: `https://github.com/organizations/<ORG>/settings/apps/new`

GitHub's manifest flow requires a **form POST** with a `manifest` field to the creation URL — the page itself does not have a manifest input field. All paths use the same helper HTML page approach.

First, create the helper page and serve it via a local web server. This works for both local and remote/headless setups (e.g., tmux/SSH into a server). The manifest JSON must be HTML-entity-escaped (replace `"` with `&quot;`) since it's placed in an HTML attribute:

```bash
# Escape the manifest JSON for safe embedding in an HTML attribute
MANIFEST_HTML_ESCAPED=$(echo '<MANIFEST_JSON>' | sed 's/"/\&quot;/g')

cat > /tmp/github-app-manifest.html << HTMLEOF
<form method="post" action="<CREATION_URL>">
  <input type="hidden" name="manifest" value="$MANIFEST_HTML_ESCAPED">
  <p>Click the button to create the GitHub App:</p>
  <button type="submit" style="font-size:18px;padding:12px 24px;">Create GitHub App</button>
</form>
HTMLEOF

# Serve the page on a local port (works for headless/remote setups)
python3 -m http.server 8976 --directory /tmp &
HTTP_SERVER_PID=$!
echo "Serving at http://localhost:8976/github-app-manifest.html"
```

After the user completes the flow, stop the server:

```bash
kill $HTTP_SERVER_PID 2>/dev/null
```

Choose the automation path based on what's available:

1. If `claude-in-chrome` MCP tools are available → use **Path A-1**
2. If `agent-browser` is installed and a Chrome debug session is connected → use **Path A-2**
3. Otherwise → use **Path B** (manual)

**Path A-1 (claude-in-chrome):**

1. Navigate to `http://localhost:8976/github-app-manifest.html`
2. Click the submit button to POST the manifest to GitHub
3. GitHub shows a confirmation page — click **Create GitHub App**
4. After redirect, extract the `code` parameter from the URL

**Path A-2 (agent-browser):**

Same flow via `agent-browser` — navigate to the helper page, click submit, then click Create.

**Path B (manual):**

Tell the user:

> 1. Open `http://localhost:8976/github-app-manifest.html` in your browser and click the button
> 2. Review the permissions on GitHub and click **Create GitHub App**
> 3. After redirect, copy the **entire URL** from the browser address bar and paste it here

Extract the `code` parameter from the redirect URL.

### Step 9: Exchange Code for Credentials

**IMPORTANT:** The `/app-manifests/<CODE>/conversions` endpoint is one-time-use. Call it exactly once.

```bash
# Store the full response temporarily (one-time-use endpoint — do NOT call twice)
umask 077
curl --fail --silent --show-error -X POST \
  -H 'Accept: application/vnd.github+json' \
  'https://api.github.com/app-manifests/<CODE>/conversions' \
  > /tmp/github-app-response.json

# Extract values (these are all secrets — handle via Bash only)
GITHUB_APP_ID=$(cat /tmp/github-app-response.json | jq -r '.id')
GITHUB_APP_SLUG=$(cat /tmp/github-app-response.json | jq -r '.slug')
GITHUB_WEBHOOK_SECRET=$(cat /tmp/github-app-response.json | jq -r '.webhook_secret')
GITHUB_APP_PEM=$(cat /tmp/github-app-response.json | jq -r '.pem')

# Clean up
rm /tmp/github-app-response.json
```

### Step 10: Write Credentials to Env

```bash
# Ensure directory exists (may not if running standalone outside bobs-factory-setup)
mkdir -p ~/.bobs-factory

# Webhook secret (for signature verification)
printf 'GITHUB_WEBHOOK_SECRET=%s\n' "$GITHUB_WEBHOOK_SECRET" >> ~/.bobs-factory/.env

# App ID (for token minting)
printf 'GITHUB_APP_ID=%s\n' "$GITHUB_APP_ID" >> ~/.bobs-factory/.env

# Bot username (for mention filtering — see note below about GitHub autocomplete)
printf 'GITHUB_BOT_USERNAME=%s\n' "$GITHUB_APP_SLUG" >> ~/.bobs-factory/.env

# Private key (multi-line — stored as a separate file)
printf '%s\n' "$GITHUB_APP_PEM" > ~/.bobs-factory/github-app.pem
chmod 600 ~/.bobs-factory/github-app.pem

# Ensure self-hosted mode is active (required for signature verification)
grep -q '^BOBS_FACTORY_HOST_EXTERNAL=' ~/.bobs-factory/.env || printf 'BOBS_FACTORY_HOST_EXTERNAL=true\n' >> ~/.bobs-factory/.env
```

Verify all values were written:

```bash
grep -c '^GITHUB_WEBHOOK_SECRET=.' ~/.bobs-factory/.env
grep -c '^GITHUB_APP_ID=.' ~/.bobs-factory/.env
grep -c '^GITHUB_BOT_USERNAME=.' ~/.bobs-factory/.env
test -f ~/.bobs-factory/github-app.pem && echo "PEM exists" || echo "PEM missing"
```

All checks must pass (return 1, 1, 1, "PEM exists").

### Step 11: Install App on Repositories

The GitHub App must be installed on the repositories Bob’s Factory will monitor.

> Go to: `https://github.com/apps/<GITHUB_APP_SLUG>/installations/new`
>
> Select which repositories (or "All repositories") and click **Install**.

Or via browser automation (navigate to URL, select repos, click Install).

After installation, capture the installation ID:

```bash
# Re-read GITHUB_APP_ID from .env (shell vars don't persist between blocks)
GITHUB_APP_ID=$(grep '^GITHUB_APP_ID=' ~/.bobs-factory/.env | cut -d= -f2-)

# Generate a JWT to authenticate as the app
GITHUB_APP_JWT=$(node -e "
const crypto = require('crypto');
const fs = require('fs');
const key = fs.readFileSync(process.env.HOME + '/.bobs-factory/github-app.pem', 'utf8');
const now = Math.floor(Date.now()/1000);
const header = Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
const payload = Buffer.from(JSON.stringify({iat:now-60,exp:now+600,iss:'$GITHUB_APP_ID'})).toString('base64url');
const sig = crypto.createSign('RSA-SHA256').update(header+'.'+payload).sign(key,'base64url');
console.log(header+'.'+payload+'.'+sig);
")

# List installations — if multiple, show all and let user pick
INSTALLATIONS=$(curl -s -H "Authorization: Bearer $GITHUB_APP_JWT" -H "Accept: application/vnd.github+json" https://api.github.com/app/installations)
echo "$INSTALLATIONS" | jq '.[] | {id, account: .account.login}'
```

If there are multiple installations, ask the user which one to use. Then write the installation ID:

```bash
printf 'GITHUB_APP_INSTALLATION_ID=%s\n' "<INSTALLATION_ID>" >> ~/.bobs-factory/.env
```

Verify:

```bash
grep -c '^GITHUB_APP_INSTALLATION_ID=.' ~/.bobs-factory/.env
```

Must return 1.

## Completion

> ✓ Built-in GitHub connection verified
> ✓ Git identity configured: `<name>` <`email`>

If webhooks were enabled:

> ✓ GitHub App created: `<GITHUB_APP_SLUG>`
> ✓ Webhook secret and app credentials saved to `~/.bobs-factory/.env`
> ✓ Private key saved to `~/.bobs-factory/github-app.pem`
> ✓ App installed (installation ID: `<GITHUB_APP_INSTALLATION_ID>`)
> ✓ Bob’s Factory will respond to `@<GITHUB_BOT_USERNAME>` mentions in PR comments

**Note:** The webhook URL will only respond successfully once Bob’s Factory is running. If GitHub shows a webhook delivery failure during setup, it will retry automatically once Bob’s Factory starts.
