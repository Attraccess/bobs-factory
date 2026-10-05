import { describe, expect, it } from "vitest";
// The dashboard uses these same browser modules; no DOM or renderer mocks.
// @ts-expect-error Plain browser JavaScript has no generated declarations.
import {
	conversationGroups,
	formatActivities,
	markdown,
	renderContent,
} from "../src/factory/web/activity.js";

const at = "2026-10-04T21:00:00.000Z";
const stamp = Date.parse(at);
const entry = (type: string, content: string, metadata = {}) => ({
	type,
	content,
	codexSessionId: "codex-1",
	metadata: { timestamp: stamp, ...metadata },
});

describe("factory conversation history", () => {
	it("does not display truncated duplicate agent JSON as workflow chat", () => {
		const result = formatActivities({
			createdAt: at,
			step: "review",
			entries: [entry("assistant", "Checking the current revision.")],
			events: [
				{
					at,
					step: "review",
					message: `{"type":"user","message":{"content":"${"x".repeat(3000)}`,
					activityTruncated: true,
				},
				{ at, step: "review", message: "Starting review" },
			],
		});
		expect(result.map((item: { body: string }) => item.body)).toEqual([
			"Checking the current revision.",
			"Starting review",
		]);
	});
	it("replaces shared CI polling chunks with one stable status without hiding agent messages", () => {
		const run = {
			status: "running",
			step: "pipeline/build-checks",
			createdAt: at,
			workflow: {
				steps: [{ id: "pipeline", type: "workflow", workflow: "shared" }],
			},
			workflowDefinitions: [
				{
					id: "shared",
					steps: [{ id: "build-checks", type: "tool", tool: "ci" }],
				},
			],
			events: [
				{
					at,
					step: "pipeline/build-checks",
					message: "Starting Watch CI (pass 1)",
				},
				...Array.from({ length: 200 }, (_, i) => ({
					at,
					step: "pipeline/build-checks",
					message:
						i % 2
							? "https://github.com/test/repo/actions/runs/1"
							: "Refreshing checks status every 10 seconds. Press Ctrl+C to quit.",
				})),
				{
					at,
					step: "ci-fix",
					message: JSON.stringify({
						type: "assistant",
						content: "Investigating the failing check.",
					}),
				},
			],
		};
		const result = formatActivities(run);
		expect(result).toHaveLength(2);
		expect(
			result.find((item: { type: string }) => item.type === "system"),
		).toEqual({
			key: "ci/pipeline/build-checks",
			at,
			step: "pipeline/build-checks",
			type: "system",
			title: "PR checks",
			body: "Waiting for PR checks…",
			status: undefined,
			raw: undefined,
		});
		expect(
			result.find((item: { type: string }) => item.type === "thought"),
		).toMatchObject({ body: "Investigating the failing check." });
		const history = [
			{
				step: run.step,
				at,
				output: {
					approved: true,
					headSha: "head",
					checks: [{ name: "Tests", bucket: "pass" }],
					receipt: "Repeated watch output",
				},
			},
		];
		expect(
			formatActivities({ ...run, status: "completed", history }).find(
				(item: { type: string }) => item.type === "system",
			),
		).toMatchObject({
			key: "ci/pipeline/build-checks",
			body: "PR checks passed.",
			raw: {
				headSha: "head",
				checks: history[0].output.checks,
				error: undefined,
			},
		});
		expect(
			formatActivities({
				...run,
				status: "failed",
				error: "GitHub unavailable",
			}).find((item: { type: string }) => item.type === "system"),
		).toMatchObject({
			body: "PR checks could not finish.",
			status: "error",
			raw: { error: "GitHub unavailable" },
		});
		expect(
			formatActivities({
				...run,
				step: "ci-fix",
				history: [
					{
						step: run.step,
						at,
						output: { approved: false, error: "Tests failed" },
					},
				],
			}).find((item: { type: string }) => item.type === "system"),
		).toMatchObject({
			body: "PR checks need attention.",
			status: "error",
			raw: { error: "Tests failed" },
		});
	});

	it("groups consecutive tools within a step without hiding conversational turns", () => {
		const activities = [
			{ key: "1", type: "thought", step: "plan" },
			{ key: "2", type: "action", step: "plan" },
			{ key: "3", type: "action", step: "plan" },
			{ key: "4", type: "action", step: "implement" },
			{ key: "5", type: "user", step: "implement" },
			{ key: "6", type: "action", step: "implement" },
		];
		expect(conversationGroups(activities)).toEqual([
			{ key: "1", type: "thought", step: "plan", items: [activities[0]] },
			{ key: "2", type: "tools", step: "plan", items: activities.slice(1, 3) },
			{ key: "4", type: "tools", step: "implement", items: [activities[3]] },
			{ key: "5", type: "user", step: "implement", items: [activities[4]] },
			{ key: "6", type: "tools", step: "implement", items: [activities[5]] },
		]);
	});

	it("includes retained clarification replies as human messages", () => {
		expect(
			formatActivities({
				answers: [{ at, answer: "Keep it local.", questions: ["Where?"] }],
			}),
		).toEqual([
			{
				key: "answer/0",
				at,
				step: "clarify",
				type: "user",
				title: "You",
				body: "Keep it local.",
			},
		]);
	});

	it("pairs interleaved tools by ID, preserving failures and full raw output", () => {
		const large = "output\n".repeat(4000);
		const activities = formatActivities({
			createdAt: at,
			events: [
				{ at, step: "implement", message: "Starting Implement (pass 1)" },
			],
			entries: [
				entry("assistant", "Inspecting **the tests**."),
				entry("assistant", "", {
					toolUseId: "a",
					toolName: "Bash",
					toolInput: { command: "pnpm test", description: "Run tests" },
				}),
				entry("assistant", "", {
					toolUseId: "b",
					toolName: "Read",
					toolInput: { file_path: "app.ts", offset: 2, limit: 3 },
				}),
				entry("user", "file contents", { toolUseId: "b" }),
				entry("user", large, { toolUseId: "a", toolResultError: true }),
				entry("assistant", "Finished."),
				entry("result", "Finished."),
			],
		});
		const actions = activities.filter(
			(item: { type: string }) => item.type === "action",
		);
		expect(actions).toHaveLength(2);
		expect(actions[0]).toMatchObject({
			title: "Bash (Run tests)",
			parameter: "pnpm test",
			status: "error",
			step: "implement",
			rawResult: { content: large },
		});
		expect(actions[1]).toMatchObject({
			title: "Read",
			parameter: "app.ts (lines 3-5)",
			status: "completed",
			result: "file contents",
		});
		expect(
			activities.filter((item: { body?: string }) => item.body === "Finished."),
		).toHaveLength(1);
		expect(
			activities.find((item: { body?: string }) => item.body === "Finished.")
				.type,
		).toBe("response");
	});

	it("reads retained SDK events when session entries are unavailable", () => {
		const messages = [
			{
				type: "assistant",
				message: {
					content: [
						{ type: "text", text: "Inspecting." },
						{
							type: "tool_use",
							id: "1",
							name: "Edit",
							input: {
								file_path: "app.ts",
								old_string: "old",
								new_string: "new",
							},
						},
					],
				},
			},
			{
				type: "user",
				message: {
					content: [
						{ type: "tool_result", tool_use_id: "1", content: "Updated" },
					],
				},
			},
			{ type: "result", result: "Done" },
		];
		const activities = formatActivities({
			events: messages.map((message) => ({
				at,
				step: "fix",
				message: JSON.stringify(message),
			})),
		});
		expect(activities.map((item: { type: string }) => item.type)).toEqual([
			"thought",
			"action",
			"response",
		]);
		expect(activities[1]).toMatchObject({
			parameter: "app.ts",
			result: "```diff\n-old\n+new\n```",
			status: "completed",
		});
	});

	it("uses complete entries instead of broken size-capped copies and decodes MCP pages", () => {
		const page = {
			path: "/ticket",
			encoding: "text",
			text: "# Requirements\n- First\n- Last",
			nextOffset: null,
		};
		const activities = formatActivities({
			createdAt: at,
			events: [{ at, step: "clarify", message: "x".repeat(20000) }],
			entries: [
				entry("assistant", "", {
					toolUseId: "mcp",
					toolName: "mcp__factory_context__read_context",
					toolInput: { path: "/ticket" },
				}),
				entry("user", JSON.stringify(page), { toolUseId: "mcp" }),
			],
		});
		expect(activities).toHaveLength(1);
		expect(activities[0]).toMatchObject({
			parameter: "/ticket",
			result: page.text,
			status: "completed",
		});
	});

	it("renders readable Markdown and structured answers without executing agent HTML", () => {
		expect(
			markdown(
				"# Heading\n**Bold** `code`\n- [x] Done\n```html\n<script>evil()</script>\n```",
			),
		).toBe(
			"<h4>Heading</h4><p><strong>Bold</strong> <code>code</code></p><ul><li>✓ Done</li></ul><pre><code>&lt;script&gt;evil()&lt;/script&gt;</code></pre>",
		);
		const result = renderContent(
			JSON.stringify({
				summary: "**Complete**",
				remainingWork: ["<img src=x onerror=evil()>"],
			}),
		);
		expect(result).toContain("<dt>remaining Work</dt>");
		expect(result).toContain("<strong>Complete</strong>");
		expect(result).not.toContain("<img");
		expect(
			markdown("[Click](javascript:evil) <svg/onload=evil()>"),
		).not.toContain("href=");
	});
});

it("keeps an old answer under its original shared step after later agent messages", () => {
	const later = new Date(stamp + 60000).toISOString();
	const events = [
		{ at, step: "pipeline/clarify", message: "Starting clarify" },
		{ at: later, step: "pipeline/plan", message: "Starting plan" },
	];
	const items = formatActivities({
		events,
		answers: [{ at, answer: "Local UI" }],
		entries: [entry("text", "Planning", { timestamp: stamp + 70000 })],
	});
	expect(items.find((item) => item.type === "user")).toMatchObject({
		step: "pipeline/clarify",
		body: "Local UI",
	});
});

it("shows each persisted chat message once, including repeated instructions and native echoes", () => {
	const result = formatActivities({
		createdAt: at,
		step: "simple",
		entries: [entry("user", "Again")],
		events: [],
		chatMessages: [
			{ id: "one", text: "Again", at, step: "simple" },
			{
				id: "two",
				text: "Again",
				at: "2026-10-04T21:01:00.000Z",
				step: "simple",
			},
		],
	});
	expect(
		result
			.filter((item: any) => item.type === "user")
			.map((item: any) => item.key),
	).toEqual(["chat/one", "chat/two"]);
});
