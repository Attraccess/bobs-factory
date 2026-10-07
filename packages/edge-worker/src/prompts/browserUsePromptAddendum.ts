/** Browser automation preference shared by issue, chat and Factory agents. */
export const HEADLESS_BROWSER_PROMPT_ADDENDUM = `
<browser_automation>
Use headless browser automation for QA, screenshots and browser verification.
Prefer the \`agent-browser\` CLI when installed (check \`command -v agent-browser\`),
using a fresh named session for this run. Start it with
\`agent-browser --headed false --session <unique-run-session> open <url>\`
so inherited headed defaults cannot open a desktop window. Use the same session
for subsequent commands and close only that session when finished.
If the CLI is unavailable, use another tool configured explicitly for headless
operation, such as Playwright with \`headless: true\`.

Keep browser work off the user's desktop: a visible browser window or attaching
to the user's existing browser requires an explicit user request. Do not use
headed mode, desktop browser automation or automatic browser attachment as a
fallback. If headless execution is blocked, report the concrete tooling/access
blocker through this role's normal assistance flow. Pass this preference to any
delegated browser/QA agents.
</browser_automation>
`.trim();

/**
 * Optional system-prompt addendum that tells the agent it has access to the
 * `agent-browser` CLI (Playwright-backed) and a local Chromium for taking
 * screenshots and driving browser flows headlessly.
 *
 * Only injected when the environment variable `CYRUS_BROWSER_USE_ENABLED` is
 * set to a truthy value. cyrus-hosted sets this on cloud-runtime droplets
 * (where chromium + agent-browser are pre-installed) and leaves it unset for
 * self-host runtimes (where the binaries may not be available).
 */
export const BROWSER_USE_PROMPT_ADDENDUM = `
<browser_use>
You have access to the \`agent-browser\` CLI (a Playwright-backed browser
automation tool) and a local Chromium install. Use it headlessly to verify
frontend changes, capture screenshots for the user, and drive browser flows.

**When to use it:**
- After making UI or frontend changes, open the running dev server in a
  browser and capture a screenshot to confirm the change renders as
  expected. Attach the screenshot when summarizing your work.
- When the user asks "what does this look like?" or requests visual proof.
- When reproducing a bug that involves browser behavior (clicks, forms,
  navigation, rendering).

**Tips:**
- Add \`sleep 0.5\` between rapid commands — each invocation spawns its own
  process and the browser needs a moment to settle.
- Use \`snapshot -i\` to find a reliable \`@ref\` before clicking; visible
  text alone can be ambiguous.
- For screenshots you intend to attach to a PR or Linear comment, write
  them to the workspace (e.g. \`./screenshot.png\`) so they're picked up by
  the upload flow.
</browser_use>
`.trim();

/**
 * Always append the headless preference. Only advertise pre-installed browser
 * tooling when `CYRUS_BROWSER_USE_ENABLED` is truthy.
 */
export function appendBrowserUseAddendum(
	existing: string | undefined | null,
): string {
	const base = (existing ?? "").trimEnd();
	const addendum = isBrowserUseEnabled()
		? `${HEADLESS_BROWSER_PROMPT_ADDENDUM}\n\n${BROWSER_USE_PROMPT_ADDENDUM}`
		: HEADLESS_BROWSER_PROMPT_ADDENDUM;
	if (base.length === 0) return addendum;
	return `${base}\n\n${addendum}`;
}

function isBrowserUseEnabled(): boolean {
	const raw = process.env.CYRUS_BROWSER_USE_ENABLED;
	if (!raw) return false;
	const normalized = raw.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes";
}
