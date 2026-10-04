import { describe, expect, it } from "vitest";
// The dashboard uses these same browser modules; no DOM or renderer mocks.
// @ts-expect-error Plain browser JavaScript has no generated declarations.
import {
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
