/**
 * Marketing demo: boots the REAL Bob's Factory runtime, HTTP server and web UI
 * against an isolated home directory. Only the agents and GitHub/CI tools are
 * scripted, so every screen shows genuine product rendering of mock work.
 *
 *   pnpm --filter 'cyrus-edge-worker...' build   # once, from the repo root
 *   bun website/demo/server.ts [--port 3700]
 */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	copyFileSync,
	cpSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { defaultWorkflows } from "../../packages/edge-worker/dist/factory/defaultWorkflows.js";
import { GeneratedGuideSchema } from "../../packages/edge-worker/dist/factory/FactoryResults.js";
import { FactoryServer } from "../../packages/edge-worker/dist/factory/FactoryServer.js";
import { createReviewSnapshot } from "../../packages/edge-worker/dist/factory/ReviewFiles.js";
import {
	type ExecutionContext,
	type FactoryRun,
	WorkflowRuntime,
} from "../../packages/edge-worker/dist/factory/WorkflowRuntime.js";

const { values } = parseArgs({
	options: {
		port: { type: "string", default: "3700" },
		home: { type: "string", default: "/tmp/bobs-factory-demo" },
	},
});
const here = fileURLToPath(new URL(".", import.meta.url));
const home = values.home!;
rmSync(home, { recursive: true, force: true });
mkdirSync(home, { recursive: true });

// ---------------------------------------------------------------------------
// A real Git repository so the review page's "Changed files" diff is genuine.
// ---------------------------------------------------------------------------
const repo = join(home, "pancake-palace");
const git = (...args: string[]) =>
	execFileSync("git", args, {
		cwd: repo,
		encoding: "utf8",
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "Bob",
			GIT_AUTHOR_EMAIL: "bob@factory.local",
			GIT_COMMITTER_NAME: "Bob",
			GIT_COMMITTER_EMAIL: "bob@factory.local",
		},
	}).trim();
cpSync(join(here, "pancake/base"), repo, { recursive: true });
git("init", "-q", "-b", "main");
git("add", "-A");
git("commit", "-q", "-m", "feat: pancake menu");
const baseSha = git("rev-parse", "HEAD");
git("checkout", "-q", "-b", "bob/dark-mode-menu");
cpSync(join(here, "pancake/head"), repo, { recursive: true });
git("add", "-A");
git("commit", "-q", "-m", "feat(menu): dark mode with remembered theme toggle");
const headSha = git("rev-parse", "HEAD");
git("checkout", "-q", "main");

// ---------------------------------------------------------------------------
// Claude-style stream messages, exactly what the real runner logs.
// ---------------------------------------------------------------------------
type Beat =
	| { say: string }
	| { think: string }
	| {
			tool: string;
			input: Record<string, unknown>;
			result: string;
			error?: boolean;
	  };
const sleep = (ms: number, signal?: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener("abort", () => {
			clearTimeout(timer);
			reject(new Error("Run terminated"));
		});
	});
async function stream(
	context: Pick<ExecutionContext, "log" | "signal">,
	beats: Beat[],
	pace: number,
) {
	const session = randomUUID();
	for (const beat of beats) {
		context.signal.throwIfAborted();
		if ("tool" in beat) {
			const id = `toolu_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
			context.log(
				JSON.stringify({
					type: "assistant",
					session_id: session,
					message: {
						role: "assistant",
						content: [
							{ type: "tool_use", id, name: beat.tool, input: beat.input },
						],
					},
				}),
				"agent",
			);
			await sleep(pace * (beat.tool === "Bash" ? 2.2 : 1), context.signal);
			context.log(
				JSON.stringify({
					type: "user",
					session_id: session,
					message: {
						role: "user",
						content: [
							{
								type: "tool_result",
								tool_use_id: id,
								content: beat.result,
								is_error: Boolean(beat.error),
							},
						],
					},
				}),
				"agent",
			);
		} else {
			context.log(
				JSON.stringify({
					type: "assistant",
					session_id: session,
					message: {
						role: "assistant",
						content:
							"think" in beat
								? [{ type: "thinking", thinking: beat.think }]
								: [{ type: "text", text: beat.say }],
					},
				}),
				"agent",
			);
		}
		await sleep(pace, context.signal);
	}
}

// ---------------------------------------------------------------------------
// Scenarios: what each scripted agent says and returns.
// ---------------------------------------------------------------------------
const read = (path: string, result: string): Beat => ({
	tool: "Read",
	input: { file_path: `/work/pancake-palace/${path}` },
	result,
});
const bash = (command: string, result: string, description?: string): Beat => ({
	tool: "Bash",
	input: { command, ...(description ? { description } : {}) },
	result,
});
const grep = (pattern: string, result: string): Beat => ({
	tool: "Grep",
	input: { pattern, path: "/work/pancake-palace" },
	result,
});
const edit = (path: string, old_string: string, new_string: string): Beat => ({
	tool: "Edit",
	input: { file_path: `/work/pancake-palace/${path}`, old_string, new_string },
	result: `The file /work/pancake-palace/${path} has been updated.`,
});

interface Scenario {
	requirements: string[];
	questions?: string[];
	decisions?: { question: string; answer: string; reason: string }[];
	plan: string;
	implementBeats: Beat[];
	summary: string;
	planRejections?: number;
	codeFindings?: {
		id: string;
		rating: number;
		summary: string;
		evidence: string;
	}[];
	ciFail?: string;
	guide?: unknown;
	visual?: boolean;
	autoApprove?: boolean;
	pr: number;
	branch: string;
}

const darkGuide = {
	tldr: "Dark mode for the menu, with a toggle that remembers your choice",
	goal: "Let night-owl guests browse the menu in a comfortable dark theme.",
	summary:
		"The menu now ships a warm dark palette, a header toggle that persists, and follows the system setting by default.",
	decision: {
		status: "ready",
		summaryShort:
			"Ready: all three criteria verified in browser tests and screenshots.",
		summary:
			"All acceptance criteria are supported by Playwright tests, QA stories and reviewed screenshots. No open findings remain.",
	},
	system: {
		lanes: [
			{ id: "browser", name: "Browser" },
			{ id: "app", name: "Menu page" },
		],
		parts: [
			{
				id: "os",
				label: "prefers-color-scheme",
				laneId: "browser",
				status: "unchanged",
			},
			{
				id: "storage",
				label: "localStorage",
				laneId: "browser",
				status: "unchanged",
			},
			{ id: "theme", label: "theme.js", laneId: "app", status: "new" },
			{
				id: "html",
				label: "index.html header",
				laneId: "app",
				status: "changed",
			},
			{
				id: "css",
				label: "styles.css tokens",
				laneId: "app",
				status: "changed",
			},
		],
		before: [{ source: "html", target: "css", label: "light only" }],
		after: [
			{ source: "os", target: "theme", label: "default" },
			{ source: "storage", target: "theme", label: "saved choice" },
			{ source: "theme", target: "html", label: "data-theme" },
			{ source: "html", target: "css", label: "token swap" },
		],
	},
	chapters: [
		{
			id: "dark-palette",
			title: "A warm dark palette for the whole menu",
			tldr: "Color tokens swap to a cocoa-dark palette",
			summary:
				"Every hard-coded color moved into CSS custom properties. A data-theme=dark block swaps them for a warm, high-contrast cocoa palette; transitions respect reduced motion.",
			before: "The menu only had a bright cream theme, glaring at night.",
			after:
				"Guests get a cozy dark menu with readable 7:1 contrast on prices and buttons.",
			beforeShort: "Bright cream theme only",
			afterShort: "Warm cocoa dark theme",
			risk: {
				level: "low",
				text: "Pure CSS token swap; light theme pixels unchanged",
			},
			keyChecks: [
				{
					do: "Open the menu with the OS in dark mode",
					expect: "Cocoa background, amber buttons",
				},
				{
					do: "Compare light screenshots to main",
					expect: "No visual change in light mode",
				},
			],
			systemPartIds: ["css"],
			requirementIndexes: [0],
			files: ["src/styles.css"],
			screenshots: [
				{
					area: "Menu page",
					state: "Dark · desktop",
					caption: "Dark menu on desktop",
					device: "Desktop",
				},
				{
					area: "Menu page",
					state: "Dark · mobile",
					caption: "Dark menu on a phone",
					device: "Mobile",
				},
				{
					area: "Menu page",
					state: "Light · desktop",
					caption: "Light theme is unchanged",
					device: "Desktop",
				},
			],
			diagrams: [],
			reviewChecks: [
				"Prices and Add buttons stay readable in both themes.",
				"Light theme looks identical to the current production menu.",
			],
			risks: [
				"Third-party embeds (none today) would need their own dark styles.",
			],
			evidence: [
				"QA story palette passed with 3 screenshots",
				"axe contrast check: 0 violations",
			],
		},
		{
			id: "theme-toggle",
			title: "A toggle that remembers the guest's choice",
			tldr: "Header toggle persists; system preference is the default",
			summary:
				"A small theme.js runs before first paint, picks the saved choice or the system preference, and wires the 🌙/☀️ header button. Playwright tests cover persistence and system defaults.",
			before: "No way to switch themes; the page ignored the OS setting.",
			after:
				"One tap toggles the theme, survives reloads, and never flashes light on load.",
			beforeShort: "No toggle, ignores OS",
			afterShort: "Toggle persists, follows OS",
			risk: {
				level: "medium",
				text: "Inline script runs before CSS paints; keep it tiny",
			},
			keyChecks: [
				{ do: "Toggle to dark, then reload", expect: "Page stays dark" },
				{ do: "Clear storage, switch OS theme", expect: "Menu follows the OS" },
				{
					do: "Tab to the toggle",
					expect: "Accessible label names the next theme",
				},
			],
			systemPartIds: ["os", "storage", "theme", "html"],
			flow: {
				title: "First paint",
				steps: [
					{
						label: "Read saved choice",
						detail: "theme.js checks localStorage for pancake-theme.",
					},
					{
						label: "Fall back to OS",
						detail: "Without a saved choice, prefers-color-scheme decides.",
					},
					{
						label: "Set data-theme",
						detail:
							"Applied on <html> before the body paints, so there is no flash.",
					},
					{
						label: "Wire the toggle",
						detail: "Clicking stores the new choice and updates the label.",
					},
				],
			},
			requirementIndexes: [1, 2],
			files: ["index.html", "src/theme.js", "test/theme.test.js"],
			screenshots: [
				{
					area: "Menu page",
					state: "Light · mobile",
					caption: "Toggle in the mobile header",
					device: "Mobile",
				},
				{
					area: "Menu page (before)",
					state: "Light · desktop",
					caption: "Before: no theme toggle",
					device: "Desktop",
				},
			],
			diagrams: [],
			reviewChecks: [
				"Toggle, reload, and confirm the theme sticks.",
				"With storage cleared, the menu follows the OS appearance.",
			],
			risks: [
				"Private-mode Safari can block localStorage; the code degrades to the OS theme.",
			],
			evidence: [
				"theme.test.js: 2 passed",
				"QA story toggle passed in Chromium and WebKit",
			],
		},
	],
	requirements: [
		{
			criterion:
				"The menu supports a dark theme that matches the brand palette",
			status: "supported",
			evidence: [
				"Screenshots: Dark · desktop, Dark · mobile",
				"axe: 0 contrast violations",
			],
		},
		{
			criterion:
				"A header toggle switches themes and remembers the guest's choice",
			status: "supported",
			evidence: ["theme.test.js › remembers the chosen theme across reloads"],
		},
		{
			criterion:
				"Follow the system preference until the guest chooses, without a light flash",
			status: "supported",
			evidence: [
				"theme.test.js › follows the system preference",
				"theme.js runs in <head>",
			],
		},
	],
	behavior: [
		{
			scenario: "Guest with a dark OS opens the menu",
			before: "Bright cream page",
			after: "Cocoa dark menu immediately",
		},
		{
			scenario: "Guest toggles and reloads",
			before: "Not possible",
			after: "Choice persists across reloads",
		},
	],
	checks: [
		"pnpm test — 14 passed",
		"playwright test test/theme.test.js — 2 passed",
		"CI: lint, unit, e2e (3/3 green)",
	],
	risks: ["Inline theme script must stay tiny to avoid delaying first paint."],
	reviewInstructions: [
		"Skim both chapters and their screenshots.",
		"Open the diff for src/theme.js — it is the only new logic.",
		"Approve to mark the PR ready and merge when checks pass.",
	],
};
GeneratedGuideSchema.parse(darkGuide);

const scenarios: Record<string, Scenario> = {
	dark: {
		pr: 128,
		branch: "bob/dark-mode-menu",
		visual: true,
		planRejections: 1,
		requirements: [
			"The menu supports a dark theme that matches the brand palette",
			"A header toggle switches themes and remembers the guest's choice",
			"Follow the system preference until the guest chooses, without a light flash",
		],
		decisions: [
			{
				question: "Should dark mode follow the operating system by default?",
				answer:
					"Yes — follow prefers-color-scheme until the guest picks a theme.",
				reason:
					"The ticket mentions night-owl guests on phones, which mostly run system dark mode.",
			},
		],
		plan: "## Plan\n1. Move hard-coded colors in `src/styles.css` into CSS custom properties.\n2. Add a `[data-theme=dark]` palette (cocoa background, amber accent, ≥ 4.5:1 contrast).\n3. Add `src/theme.js`, loaded in `<head>`, to apply saved/system theme before paint.\n4. Add a 🌙/☀️ toggle in the header with an accessible label.\n5. Cover persistence + system default with Playwright (`test/theme.test.js`).",
		implementBeats: [
			{
				think:
					"Colors are hard-coded in a few places. Tokens first, then the dark palette, then the toggle.",
			},
			read(
				"src/styles.css",
				":root {\n\t--bg: #fff8ee;\n\t--card: #ffffff;\n\t--ink: #3b2414; …",
			),
			grep(
				"#fff1dc|#b4783a",
				"src/styles.css:52: .art { … background: #fff1dc; …\nsrc/styles.css:46: box-shadow: 0 10px 30px #b4783a14;",
			),
			edit(
				"src/styles.css",
				"\t--line: #f3e2cf;\n}",
				'\t--line: #f3e2cf;\n\t--art: #fff1dc;\n\t--shadow: 0 10px 30px #b4783a14;\n}\n:root[data-theme="dark"] { … }',
			),
			{
				say: "Palette tokens are in. Now the theme script — it has to run in `<head>` so returning guests never see a light flash.",
			},
			{
				tool: "Write",
				input: {
					file_path: "/work/pancake-palace/src/theme.js",
					content: "// Applied before first paint…",
				},
				result:
					"File created successfully at: /work/pancake-palace/src/theme.js",
			},
			edit(
				"index.html",
				'<link rel="stylesheet" href="src/styles.css" />',
				'<link rel="stylesheet" href="src/styles.css" />\n<script src="src/theme.js"></script>',
			),
			{
				tool: "Write",
				input: {
					file_path: "/work/pancake-palace/test/theme.test.js",
					content: 'test("remembers the chosen theme…")',
				},
				result:
					"File created successfully at: /work/pancake-palace/test/theme.test.js",
			},
			bash(
				"pnpm playwright test test/theme.test.js",
				"Running 2 tests using 2 workers\n  ✓ remembers the chosen theme across reloads (812ms)\n  ✓ follows the system preference until the guest chooses (604ms)\n\n  2 passed (2.1s)",
				"Run theme tests",
			),
			bash(
				"pnpm test",
				"Test Files  6 passed (6)\n     Tests  14 passed (14)",
				"Run unit tests",
			),
			{
				say: "Dark mode is implemented and tested: tokens, palette, pre-paint theme script, header toggle and two Playwright tests.",
			},
		],
		summary:
			"Implemented dark mode with persisted toggle and system default; 14 unit + 2 e2e tests pass.",
		codeFindings: [
			{
				id: "toggle-label",
				rating: 2,
				summary:
					"The toggle's aria-label doesn't update after switching themes.",
				evidence: "src/theme.js:9 — label is set once at load",
			},
		],
		guide: darkGuide,
	},
	favourites: {
		pr: 131,
		branch: "bob/favourite-stacks",
		requirements: [
			"Guests can save favourite stacks",
			"Favourites appear at the top of the menu",
		],
		questions: [
			'**Where should favourites live for guests who aren\'t signed in?**\n\nThe ticket says *"let guests save favourite stacks"*, but Pancake Palace has no accounts yet — only a cart cookie.\n\n- **Browser only (localStorage):** ships today, but favourites vanish on a new phone.\n- **Anonymous guest ID + API:** survives devices via a magic link, but needs a new `favourites` table and a migration.\n\nWhich should Bob build?',
			"**Should favourites reorder the menu, or get their own ★ row?**\n\nReordering keeps the page short; a separate row is easier to scan but pushes the menu down on phones.",
		],
		plan: "",
		implementBeats: [],
		summary: "",
	},
	checkout: {
		pr: 133,
		branch: "bob/checkout-p95",
		requirements: [
			"Checkout API p95 under 250 ms at 50 rps",
			"No change to order totals or receipts",
		],
		plan: "## Plan\n1. Profile `POST /checkout` with autocannon.\n2. Batch the N+1 topping lookups into one query.\n3. Cache the tax table for 5 minutes.\n4. Add a perf regression test to CI.",
		implementBeats: [
			{ think: "Start with a baseline so the improvement is measurable." },
			bash(
				"pnpm autocannon -c 50 -d 20 http://localhost:3000/checkout",
				"Latency p50 182 ms · p95 612 ms · p99 940 ms\n1,003 requests in 20s",
				"Benchmark checkout",
			),
			read(
				"src/api/checkout.ts",
				"for (const item of cart.items) {\n  item.toppings = await db.toppings.findMany({ where: { stackId: item.id } });\n}",
			),
			{
				say: "Found it: one topping query per cart item (N+1). Batching into a single `IN` query.",
			},
			edit(
				"src/api/checkout.ts",
				"for (const item of cart.items) {",
				"const toppings = await db.toppings.findMany({ where: { stackId: { in: ids } } });",
			),
			grep(
				"taxTable",
				"src/api/tax.ts:4: export async function taxTable() { return db.tax.findMany(); }",
			),
			edit(
				"src/api/tax.ts",
				"export async function taxTable()",
				"export const taxTable = memoize(loadTaxTable, { ttl: 300_000 })",
			),
			bash("pnpm test src/api", "Tests  38 passed (38)", "Run API tests"),
			bash(
				"pnpm autocannon -c 50 -d 20 http://localhost:3000/checkout",
				"Latency p50 41 ms · p95 118 ms · p99 203 ms\n4,870 requests in 20s",
				"Re-run benchmark",
			),
			{
				say: "p95 dropped from 612 ms to 118 ms. Adding a CI perf budget so it stays there.",
			},
			{
				tool: "Write",
				input: { file_path: "/work/pancake-palace/test/perf/checkout.perf.ts" },
				result: "File created successfully",
			},
			bash(
				"pnpm test:perf",
				"checkout p95 121 ms ≤ budget 250 ms ✓",
				"Run perf budget",
			),
		],
		summary:
			"Batched topping lookups and cached the tax table: checkout p95 612 ms → 118 ms.",
	},
	syrup: {
		pr: 119,
		branch: "bob/syrup-rounding",
		autoApprove: true,
		requirements: [
			"Receipts round syrup add-ons to the cent",
			"Totals match the payment provider",
		],
		plan: "Use integer cents for add-on math in `src/receipt.ts`; add property tests.",
		implementBeats: [
			read("src/receipt.ts", "total += addon.price * addon.qty // 0.1 + 0.2 …"),
			{ say: "Classic floating point. Switching to integer cents." },
			edit(
				"src/receipt.ts",
				"total += addon.price * addon.qty",
				"totalCents += addon.priceCents * addon.qty",
			),
			bash("pnpm test receipt", "Tests  22 passed (22)"),
		],
		summary:
			"Receipts use integer cents; property tests cover 10k random carts.",
		codeFindings: [],
	},
	german: {
		pr: 124,
		branch: "bob/menu-de",
		autoApprove: true,
		requirements: ["Menu available in German", "Language follows the browser"],
		plan: "Extract strings to `locales/en.json`, add `de.json`, pick via `navigator.language`.",
		implementBeats: [
			grep("Fresh off the griddle", "index.html:19"),
			{
				tool: "Write",
				input: { file_path: "/work/pancake-palace/locales/de.json" },
				result: "File created successfully",
			},
			bash("pnpm test i18n", "Tests  9 passed (9)"),
		],
		summary: "German menu with automatic language detection.",
	},
	postgres: {
		pr: 102,
		branch: "bob/pg18",
		requirements: [
			"Orders table runs on Postgres 18",
			"Zero-downtime migration",
		],
		plan: "Dual-write orders, backfill, then switch reads behind a flag.",
		implementBeats: [
			bash("pnpm db:migrate --dry-run", "✓ 3 migrations planned"),
			{ say: "Migration planned. Pushing for CI." },
		],
		summary: "Dual-write migration for the orders table.",
		ciFail:
			'Merge readiness: 2/3 checks passed; e2e/orders failed 3 times (`relation "orders_v2" does not exist` on the CI database). CI needs the Postgres 18 service image before Bob can continue.',
	},
};

// ---------------------------------------------------------------------------
// Scripted hooks wired into the real runtime.
// ---------------------------------------------------------------------------
const meta = new Map<
	string,
	{ scenario: Scenario; pace: number; live?: boolean }
>();
const shots = join(here, "assets/pancake");
const evidenceShots = [
	[
		"Menu page (before)",
		"Light · desktop",
		"before-desktop.png",
		"Before: light theme only, no toggle",
	],
	[
		"Menu page",
		"Light · desktop",
		"after-light-desktop.png",
		"Light theme unchanged, new toggle in header",
	],
	[
		"Menu page",
		"Dark · desktop",
		"after-dark-desktop.png",
		"Warm cocoa dark theme on desktop",
	],
	[
		"Menu page",
		"Dark · mobile",
		"after-dark-mobile.png",
		"Dark theme on a 390 px phone",
	],
	[
		"Menu page",
		"Light · mobile",
		"after-light-mobile.png",
		"Mobile header with the theme toggle",
	],
] as const;

const fakeSha = (seed: string) => createHash("sha1").update(seed).digest("hex");
const prUrl = (s: Scenario) =>
	`https://github.com/syrup-co/pancake-palace/pull/${s.pr}`;

const runtime: WorkflowRuntime = new WorkflowRuntime(home, {
	agent: async (context) => {
		const m = meta.get(context.run.id)!;
		const { scenario: s, pace } = m;
		const step = context.step.id;
		const visits = context.run.history.filter((h) =>
			h.step.endsWith(step),
		).length;
		const beats = (b: Beat[]) => stream(context, b, pace);
		switch (step) {
			case "clarify": {
				const answered = context.run.answers.length > 0;
				await beats([
					{
						think:
							"Reading the ticket, comments and repository conventions before deciding whether anything is ambiguous.",
					},
					read(
						"README.md",
						"# Pancake Palace\nVanilla JS storefront. Tests: vitest + playwright.",
					),
					grep("TODO|FIXME", "src/menu.js:3: // TODO: seasonal specials"),
					{
						say:
							answered || !s.questions
								? "Requirements are clear. Recording decisions."
								: "Two product decisions change the implementation, so I'm asking before planning.",
					},
				]);
				return {
					questions: answered ? [] : (s.questions ?? []),
					decisions: s.decisions ?? [],
					requirements: s.requirements,
				};
			}
			case "plan":
				await beats([
					read("src/menu.js", "export const menu = [ … ]"),
					{
						say: visits
							? "Revised the plan to include the reduced-motion and contrast requirements from review."
							: "Drafting a lean plan.",
					},
				]);
				return { plan: s.plan, assets: [] };
			case "plan-review": {
				const approved = visits >= (s.planRejections ?? 0);
				await beats([
					{
						say: approved
							? "Plan covers every requirement and decision. Approved."
							: "Missing: reduced-motion handling and a contrast target. Sending back.",
					},
				]);
				return {
					approved,
					feedback: approved
						? []
						: [
								"Respect prefers-reduced-motion for theme transitions.",
								"State a measurable contrast target (≥ 4.5:1).",
							],
				};
			}
			case "implement":
				await beats(s.implementBeats);
				if (m.live) {
					// Keep the "live" run visibly busy for recordings.
					const loops: Beat[][] = [
						[
							{
								say: "Double-checking that receipts are byte-identical before and after.",
							},
							bash(
								"pnpm test src/receipt",
								"Tests  22 passed (22)",
								"Run receipt tests",
							),
						],
						[
							{
								think:
									"Cache invalidation: the tax table changes at most daily, 5 minutes is safe. Verify the admin save path busts it anyway.",
							},
							grep(
								"saveTaxTable",
								"src/admin/tax.ts:31: await saveTaxTable(rows)",
							),
							edit(
								"src/admin/tax.ts",
								"await saveTaxTable(rows)",
								"await saveTaxTable(rows);\ntaxTable.clear();",
							),
						],
						[
							bash(
								"pnpm autocannon -c 100 -d 20 http://localhost:3000/checkout",
								"Latency p50 52 ms · p95 141 ms · p99 233 ms\n9,412 requests in 20s",
								"Stress at 100 rps",
							),
							{ say: "Still well under budget at double the target load. 🥞" },
						],
						[
							read(
								"src/api/checkout.ts",
								"const toppings = await db.toppings.findMany({ where: { stackId: { in: ids } } });",
							),
							{
								say: "Adding an index on `toppings.stack_id` so the batched query stays fast as the menu grows.",
							},
							{
								tool: "Write",
								input: {
									file_path:
										"/work/pancake-palace/migrations/0042_toppings_stack_idx.sql",
								},
								result: "File created successfully",
							},
						],
						[
							bash(
								"pnpm lint && pnpm typecheck",
								"✓ 0 problems · types OK",
								"Lint and typecheck",
							),
						],
					];
					for (let i = 0; ; i++) await beats(loops[i % loops.length]!);
				}
				return {
					status: "completed",
					summary: s.summary,
					checks: ["pnpm test", "pnpm lint"],
					questions: [],
				};
			case "code-review": {
				const findings = visits === 0 ? (s.codeFindings ?? []) : [];
				await beats([
					bash(
						`git diff main...${s.branch} --stat`,
						" index.html          |  2 +\n src/styles.css      | 28 ++++++--\n src/theme.js        | 24 +++++++\n test/theme.test.js  | 17 ++++++",
					),
					{
						say: findings.length
							? `Found ${findings.length} issue worth fixing: ${findings[0]!.summary}`
							: "Diff matches the plan; no open findings.",
					},
				]);
				return {
					summary: findings.length ? "One accessibility issue" : "Clean",
					findings: findings.map((f) => ({ ...f, status: "open" })),
				};
			}
			case "code-fix":
				await beats([
					edit(
						"src/theme.js",
						"const apply = (theme) => {",
						'const apply = (theme) => {\n\tbutton.setAttribute("aria-label", …)',
					),
					bash("pnpm test", "Tests  14 passed (14)"),
				]);
				return {
					summary: "Toggle label now names the next theme on every switch.",
					dispositions: (s.codeFindings ?? []).map((f) => ({
						id: f.id,
						status: "fixed",
						reason: "Label updated in apply()",
					})),
				};
			case "ci-fix":
				await beats([{ say: "Looking at the failing e2e job." }]);
				return {
					summary: "No code change",
					dispositions: [],
					reviewRequired: false,
				};
			case "visual-scope":
				await beats([
					{
						say: s.visual
							? "The menu page changed visually; planning 5 captures across themes and devices."
							: "No visual surface changed.",
					},
				]);
				return s.visual
					? {
							qaContract: "qa-v1",
							changed: true,
							captureBudget: 24,
							areas: [
								{
									name: "Menu page",
									url: "/",
									states: [
										"Light · desktop",
										"Dark · desktop",
										"Dark · mobile",
										"Light · mobile",
									],
									instructions:
										"Toggle theme via the header button; emulate OS theme for defaults.",
								},
								{
									name: "Menu page (before)",
									url: "/ (main)",
									states: ["Light · desktop"],
									instructions: "Capture main for comparison.",
								},
							],
							stories: [
								{
									id: "palette",
									goal: "Guest browses the menu in dark mode",
									requirementRefs: ["requirements/0"],
									interface: "ui",
									preconditions: ["Dev server on :5173"],
									fixtures: ["Default menu"],
									actions: ["Emulate dark OS theme", "Open the menu"],
									criteria: [
										{
											id: "readable",
											expected: "Dark palette with readable prices and buttons",
										},
									],
									evidenceInstructions:
										"Screenshot desktop + mobile; run axe contrast check",
									screenshotTasks: [
										{ area: "Menu page", state: "Dark · desktop" },
										{ area: "Menu page", state: "Dark · mobile" },
										{ area: "Menu page", state: "Light · desktop" },
										{ area: "Menu page (before)", state: "Light · desktop" },
									],
								},
								{
									id: "toggle",
									goal: "Guest switches theme and it sticks",
									requirementRefs: ["requirements/1", "requirements/2"],
									interface: "ui",
									preconditions: ["Fresh browser profile"],
									fixtures: [],
									actions: ["Click the header toggle", "Reload"],
									criteria: [
										{
											id: "persisted",
											expected: "Theme persists across reload",
										},
									],
									evidenceInstructions: "Playwright run + mobile screenshot",
									screenshotTasks: [
										{ area: "Menu page", state: "Light · mobile" },
									],
								},
							],
							exclusions: [],
						}
					: {
							qaContract: "qa-v1",
							changed: false,
							areas: [],
							stories: [],
							exclusions: [],
							notApplicableReason:
								"Server-only change with no rendered surface affected.",
						};
			case "capture": {
				if (!s.visual)
					return {
						qaContract: "qa-v1",
						screenshots: [],
						unavailable: [],
						results: [],
						findings: [],
						observations: [],
						notApplicableReason: "No UI surface changed in this PR.",
					};
				await beats([
					bash(
						"pnpm dev --port 5173",
						"VITE ready in 212 ms  ➜  Local: http://localhost:5173/",
						"Start dev server",
					),
					{
						tool: "mcp__playwright__browser_navigate",
						input: { url: "http://localhost:5173/" },
						result: "Navigated to Pancake Palace — Menu",
					},
					{
						tool: "mcp__playwright__browser_take_screenshot",
						input: { filename: "after-dark-desktop.png" },
						result: "Saved screenshot",
					},
					{
						tool: "mcp__playwright__browser_resize",
						input: { width: 390, height: 844 },
						result: "Resized",
					},
					{
						tool: "mcp__playwright__browser_take_screenshot",
						input: { filename: "after-dark-mobile.png" },
						result: "Saved screenshot",
					},
					bash(
						"npx axe http://localhost:5173 --tags wcag2aa",
						"0 violations found",
					),
				]);
				const screenshots = evidenceShots.map(
					([area, state, file, caption]) => {
						copyFileSync(join(shots, file), join(context.evidenceDir, file));
						return {
							area,
							state,
							caption,
							path: file,
							revision: headSha,
							imageSha256: createHash("sha256")
								.update(readFileSync(join(shots, file)))
								.digest("hex"),
						};
					},
				);
				return {
					qaContract: "qa-v1",
					screenshots,
					unavailable: [],
					findings: [],
					observations: [
						{
							id: "contrast",
							summary: "axe reports 0 contrast violations in both themes",
							evidence: "axe wcag2aa run",
						},
					],
					results: [
						{
							storyId: "palette",
							outcome: "passed",
							criteria: [
								{
									criterionId: "readable",
									outcome: "passed",
									expected: "Dark palette with readable prices and buttons",
									observed:
										"Cocoa palette; prices 12.4:1, buttons 9.8:1 contrast",
									evidence: [
										{
											kind: "browser",
											executed: true,
											action: "Emulated dark OS; opened /",
											details: "Captured desktop + mobile",
											screenshotTasks: [
												{ area: "Menu page", state: "Dark · desktop" },
												{ area: "Menu page", state: "Dark · mobile" },
											],
										},
									],
								},
							],
						},
						{
							storyId: "toggle",
							outcome: "passed",
							criteria: [
								{
									criterionId: "persisted",
									outcome: "passed",
									expected: "Theme persists across reload",
									observed: "data-theme=dark after reload",
									evidence: [
										{
											kind: "test",
											executed: true,
											action: "playwright test test/theme.test.js",
											details: "2 passed",
											exitCode: 0,
										},
									],
								},
							],
						},
					],
				};
			}
			case "visual-review":
				await beats([
					{
						say: "Screenshots match the stories: readable contrast, toggle visible on mobile, light theme unchanged.",
					},
				]);
				return {
					qaContract: "qa-v1",
					summary: "Visual QA passed",
					findings: [],
					acceptedScreenshots: s.visual
						? evidenceShots.map(([area, state, file]) => ({
								area,
								state,
								imageSha256: createHash("sha256")
									.update(readFileSync(join(shots, file)))
									.digest("hex"),
							}))
						: [],
				};
			case "guide": {
				await beats([
					{
						say: "Writing the human review guide: chapters, screenshots, risks and what to check.",
					},
				]);
				if (s.guide) {
					const reviewFiles = await createReviewSnapshot(
						context.evidenceDir,
						context.run.id,
						repo,
						baseSha,
						headSha,
					);
					return { ...(s.guide as object), reviewFiles };
				}
				return {
					tldr: s.summary.slice(0, 90),
					goal: s.requirements[0],
					summary: s.summary,
					decision: {
						status: "ready",
						summaryShort: "Ready for review",
						summary: "All requirements verified.",
					},
					requirements: s.requirements.map((criterion) => ({
						criterion,
						status: "supported",
						evidence: ["Tests pass"],
					})),
					behavior: [],
					checks: ["pnpm test"],
					risks: [],
					reviewInstructions: ["Review the diff and approve."],
				};
			}
			default:
				await beats([{ say: `Working on ${context.step.name}.` }]);
				return {};
		}
	},
	script: async () => ({}),
	tool: async (context) => {
		const { scenario: s, pace } = meta.get(context.run.id)!;
		const head = s.guide ? headSha : fakeSha(s.branch);
		await sleep(pace);
		switch (context.step.tool) {
			case "record-decisions":
				return context.run.outputs.clarify;
			case "draft-pr":
				context.log(`Pushed ${s.branch} and opened draft PR #${s.pr}`);
				return { url: prUrl(s), branch: s.branch, headSha: head };
			case "review-gate":
			case "visual-gate": {
				const review = context.run.outputs[
					context.step.tool === "review-gate" ? "code-review" : "visual-review"
				] as { findings: { status: string }[] };
				const open = review.findings.filter((f) => f.status === "open");
				return { approved: open.length === 0, findings: open };
			}
			case "ci":
				if (s.ciFail) throw new Error(s.ciFail);
				context.log(
					"Merge readiness: 3/3 checks passed; Approve the review guide to mark the PR ready",
				);
				return {
					approved: true,
					reviewReady: true,
					headSha: head,
					baseSha,
					checks: { passed: 3, total: 3 },
				};
			case "review-after-fix":
				return { reviewRequired: true, headSha: head, baseSha };
			case "handoff":
				context.log(`Updated PR #${s.pr} description with the review guide`);
				return { headSha: head, url: prUrl(s) };
			case "human-review":
				return { headSha: head, url: prUrl(s) };
			case "merge":
				context.log(`GitHub confirmed PR #${s.pr} merged`);
				return { merged: true, state: "MERGED", url: prUrl(s), headSha: head };
			default:
				return {};
		}
	},
	simple: async (run, signal) => {
		await stream(
			{
				signal,
				log: (message, source) => runtime.log(run, "Cyrus", message, source),
			},
			[
				{
					think:
						"Flaky only on CI usually means timing or shared state. Checking the waffle iron mock.",
				},
				grep(
					"waffleIron",
					"test/waffle.test.js:12: const iron = await heatWaffleIron({ timeout: 50 })",
				),
				read(
					"test/waffle.test.js",
					"test('waffles are crispy', async () => {\n  const iron = await heatWaffleIron({ timeout: 50 });\n  …",
				),
				bash(
					"for i in $(seq 20); do pnpm vitest run test/waffle.test.js || echo FAIL; done | grep -c FAIL",
					"4",
					"Repeat test 20×",
				),
				{
					say: "Reproduced: 4/20 failures. The 50 ms heat timeout races the fake timer on slower CI runners.",
				},
				edit(
					"test/waffle.test.js",
					"heatWaffleIron({ timeout: 50 })",
					"vi.useFakeTimers();\nconst iron = heatWaffleIron();\nawait vi.runAllTimersAsync();",
				),
				bash(
					"for i in $(seq 50); do pnpm vitest run test/waffle.test.js || echo FAIL; done | grep -c FAIL",
					"0",
					"Repeat test 50×",
				),
			],
			8,
		);
		runtime.log(
			run,
			"Cyrus",
			JSON.stringify({
				type: "result",
				subtype: "success",
				result:
					"**Root cause:** `heatWaffleIron` used a real 50 ms timeout that raced fake timers on slower CI runners (4/20 local failures).\n\n**Fix:** drive the iron with `vi.useFakeTimers()` + `runAllTimersAsync()`. 0/50 failures after the change.",
			}),
			"agent",
		);
	},
});

const factory = defaultWorkflows.find((w) => w.id === "factory")!;
const takeover = defaultWorkflows.find((w) => w.id === "takeover")!;
const simple = defaultWorkflows.find((w) => w.id === "simple")!;
const definitions = defaultWorkflows.filter((w) => w.id === "factory-pipeline");

/** Stand in for the title agent so runs carry their generated titles. */
function named(run: FactoryRun, title: string) {
	runtime.updateTitle(
		run.id,
		{ ...run.titleGeneration!, state: "completed" },
		title,
	);
}

function start(
	title: string,
	scenario: Scenario,
	options: {
		pace?: number;
		live?: boolean;
		workflow?: typeof factory;
		input?: string;
		source?: string;
		ticket?: string;
	} = {},
) {
	const workflow = options.workflow ?? factory;
	const run = runtime.create({
		id: `manual-${randomUUID()}`,
		title,
		triggerOrigin: options.ticket
			? {
					type: "ticket-assignment",
					workflowId: workflow.id,
					selectionMethod: "label",
					selection: { source: "label", label: "workflow:factory" },
					at: new Date().toISOString(),
					ticket: {
						provider: "linear",
						subtype: "assignment",
						workspaceId: "syrup-co",
						issueId: options.ticket,
						identifier: options.ticket,
						url: `https://linear.app/syrup-co/issue/${options.ticket}`,
						agentSessionId: randomUUID(),
					},
				}
			: {
					type: "manual",
					workflowId: workflow.id,
					at: new Date().toISOString(),
					manual: { method: "composer-api" },
				},
		workflowDefinitions: workflow.id === "simple" ? [] : definitions,
		repositoryId: "pancake",
		workspace: repo,
		workflow,
		input: options.input ?? title,
		source: options.source,
		runner: "claude",
		model: "claude-opus-5-5",
	} as Parameters<typeof runtime.create>[0]);
	named(run, title);
	meta.set(run.id, { scenario, pace: options.pace ?? 4, live: options.live });
	void runtime.launch(run).catch(() => {});
	return run;
}

async function until(run: FactoryRun, done: (run: FactoryRun) => boolean) {
	while (!done(run)) await sleep(25);
}
/** Make seeded work look like it happened over the past days. */
function age(run: FactoryRun, minutes: number) {
	const shift = (iso: string) =>
		new Date(Date.parse(iso) - minutes * 60_000).toISOString();
	const r = run as FactoryRun & Record<string, any>;
	r.createdAt = shift(r.createdAt);
	r.updatedAt = shift(r.updatedAt);
	for (const list of [
		r.history,
		r.events,
		r.activitySteps ?? [],
		r.answers,
		r.humanDecisions ?? [],
		r.workflowCalls ?? [],
	])
		for (const item of list) if (item.at) item.at = shift(item.at);
	if (r.triggerOrigin?.at) r.triggerOrigin.at = shift(r.triggerOrigin.at);
	writeFileSync(
		join(runtime.directory, "runs", `${encodeURIComponent(run.id)}.json`),
		JSON.stringify(run),
	);
}

// --- Seed history -----------------------------------------------------------
const syrup = start("Fix syrup rounding on receipts", scenarios.syrup!, {
	pace: 2,
	ticket: "PAN-41",
});
const german = start("Translate the menu to German", scenarios.german!, {
	pace: 2,
});
for (const run of [syrup, german]) {
	await until(run, (r) => r.reviewGate?.status === "pending");
	runtime.decide(run.id, {
		reviewId: run.reviewGate!.id,
		headSha: run.reviewGate!.headSha,
		decision: "approve",
	});
	await until(run, (r) => r.status === "completed");
}
const waffle = runtime.create({
	id: `manual-${randomUUID()}`,
	title: "Why does the waffle test flake on CI?",
	triggerOrigin: {
		type: "manual",
		workflowId: "simple",
		at: new Date().toISOString(),
		manual: { method: "composer-api" },
	},
	repositoryId: "pancake",
	workspace: repo,
	workflow: simple,
	input: "test/waffle.test.js fails ~1 in 5 CI runs. Find out why and fix it.",
	runner: "claude",
	model: "claude-opus-5-5",
} as Parameters<typeof runtime.create>[0]);
named(waffle, "Why does the waffle test flake on CI?");
meta.set(waffle.id, { scenario: scenarios.syrup!, pace: 2 });
await runtime.launch(waffle).catch(() => {});

const postgres = start(
	"Migrate the orders table to Postgres 18",
	scenarios.postgres!,
	{
		pace: 2,
		workflow: takeover,
		source: "https://github.com/syrup-co/pancake-palace/pull/102",
		input: "Continue the existing work described by this PR or ticket.",
	},
);
await until(postgres, (r) =>
	["failed", "completed", "waiting"].includes(r.status),
);

const dark = start("Dark mode for the menu page", scenarios.dark!, {
	pace: 3,
	ticket: "PAN-57",
});
await until(dark, (r) => r.reviewGate?.status === "pending");
const favourites = start(
	"Let guests save favourite stacks",
	scenarios.favourites!,
	{ pace: 3, ticket: "PAN-62" },
);
await until(
	favourites,
	(r) => r.status === "waiting" && r.questions.length > 0,
);

age(syrup, 60 * 26);
age(german, 60 * 7);
age(waffle, 60 * 5 + 12);
age(postgres, 95);
age(dark, 38);
age(favourites, 14);

// The live one: streams activity while you watch.
start("Speed up checkout API p95", scenarios.checkout!, {
	pace: 2600,
	live: true,
	ticket: "PAN-64",
});

// ---------------------------------------------------------------------------
const server = new FactoryServer(runtime, {
	repositories: () => [{ id: "pancake", name: "pancake-palace" }],
	sessions: () => [],
	entries: () => [],
	defaultRunner: () => "claude",
	start: async (input) => {
		const workflow =
			defaultWorkflows.find((w) => w.id === input.workflow) ?? factory;
		const prompt = input.prompt || "New feature";
		return start(
			prompt.split("\n")[0]!.slice(0, 80),
			{
				...scenarios.checkout!,
				implementBeats: scenarios.dark!.implementBeats,
			},
			{
				pace: 1800,
				workflow,
				input: prompt,
			},
		);
	},
	stop: (id) => runtime.stop(id),
});
await server.start(Number(values.port));
console.log(
	`Bob's Factory demo: http://127.0.0.1:${values.port}  (state: ${home})`,
);
