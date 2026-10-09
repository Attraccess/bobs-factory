import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it } from "vitest";
import { FactoryClient } from "./client.js";
import { AnswerForm, LaunchForm } from "./forms.js";
import { tuiPort } from "./index.js";
import {
	conversation,
	type RunItem,
	stepStrip,
	today,
	toolSummary,
} from "./model.js";
import {
	KeyParser,
	parseKeys,
	Screen,
	sanitize,
	TextInput,
	width,
	wrap,
} from "./terminal.js";
import { ansi256, tokens } from "./theme.js";

const servers: Server[] = [];
afterEach(() => {
	for (const server of servers.splice(0)) server.close();
});

const at = (minutes: number) =>
	new Date(Date.now() - minutes * 60000).toISOString();
const run = (
	id: string,
	status: string,
	extra: Partial<RunItem> = {},
): RunItem => ({
	id,
	title: id,
	status,
	createdAt: at(10),
	updatedAt: at(1),
	...extra,
});

it("groups Today like the dashboard: questions, stuck, reviews first; settled out", () => {
	const runs = [
		run("working", "running"),
		run("review", "waiting", { reviewGate: { status: "pending" } }),
		run("stuck", "failed"),
		run("question", "waiting"),
		run("settled", "completed", { viewState: { settledAt: at(1) } }),
		run("stopped", "stopped"),
	];
	const { needsYou, working, settled } = today(runs);
	expect(needsYou.map((r) => r.id)).toEqual(["question", "stuck", "review"]);
	expect(working.map((r) => r.id)).toEqual(["working"]);
	expect(settled.map((r) => r.id).sort()).toEqual(["settled", "stopped"]);
});

it("builds a conversation with step markers, tool results and chat messages", () => {
	const lines = conversation(
		{
			entries: [
				{
					type: "user",
					content: "Build it",
					metadata: { timestamp: at(9) },
					activityStep: "plan",
				},
				{
					type: "assistant",
					content: "",
					metadata: {
						timestamp: at(8),
						toolUseId: "1",
						toolName: "Bash",
						toolInput: { command: "pnpm  test" },
					},
					activityStep: "plan",
				},
				{
					type: "user",
					content: "boom",
					metadata: { timestamp: at(7), toolUseId: "1", toolResultError: true },
					activityStep: "plan",
				},
				{
					type: "assistant",
					content: "Done.",
					metadata: { timestamp: at(6) },
					activityStep: "implement",
				},
				{
					type: "result",
					content: "Done.",
					metadata: { timestamp: at(5) },
					activityStep: "implement",
				},
			],
			events: [
				{
					at: at(4),
					step: "implement",
					message: "Finished Implement",
					source: "workflow",
				},
			],
		},
		[
			{ text: "Build it", at: at(9) },
			{ text: "Also add docs", at: at(3), step: "implement" },
		],
	);
	expect(
		lines.map((line) =>
			[line.kind, line.text, line.detail, line.status].filter(Boolean),
		),
	).toEqual([
		["step", "plan"],
		["you", "Build it"],
		["tool", "Bash", "pnpm test", "error"],
		["step", "implement"],
		["response", "Done."],
		["system", "Finished Implement"],
		["you", "Also add docs"],
	]);
	expect(toolSummary("mcp__linear__get_issue", { query: "BOB-1" })).toEqual({
		label: "linear · get_issue",
		detail: "BOB-1",
	});
});

it("marks visited, current and failed steps in the strip", () => {
	expect(
		stepStrip({
			...run("r", "failed", { step: "implement" }),
			workflow: {
				id: "w",
				name: "W",
				steps: [
					{ id: "plan", name: "Plan" },
					{ id: "implement" },
					{ id: "verify" },
				],
			},
			history: [{ step: "plan", at: at(5) }],
		}),
	).toEqual([
		{ name: "Plan", state: "done" },
		{ name: "implement", state: "failed" },
		{ name: "verify", state: "pending" },
	]);
});

it("parses keys, pastes and multi-byte text", () => {
	expect(parseKeys("\x1b[A\x1b[Bab\r\x7f\x1b")).toEqual([
		{ name: "up" },
		{ name: "down" },
		{ name: "text", text: "ab" },
		{ name: "enter" },
		{ name: "backspace" },
		{ name: "escape" },
	]);
	expect(parseKeys("\x1b[200~line 1\r\nline 2\x1b[201~")).toEqual([
		{ name: "paste", text: "line 1\nline 2" },
	]);
	expect(parseKeys("\x03\x1d😀")).toEqual([
		{ name: "ctrl-c" },
		{ name: "ctrl-]" },
		{ name: "text", text: "😀" },
	]);
});

it("holds fragmented terminal keys and pastes without interpreting pasted newlines as submission", () => {
	const parser = new KeyParser();
	expect(parser.push("\x1b[")).toEqual([]);
	expect(parser.push("A")).toEqual([{ name: "up" }]);
	expect(parser.push("\x1b[20")).toEqual([]);
	expect(parser.push("0~fix\r\n")).toEqual([]);
	expect(parser.push("the bug\x1b[201")).toEqual([]);
	expect(parser.push("~\r")).toEqual([
		{ name: "paste", text: "fix\nthe bug" },
		{ name: "enter" },
	]);
	expect(parser.push("\x1b")).toEqual([]);
	expect(parser.flushEscape()).toEqual([{ name: "escape" }]);
});

it("uses the saved recipe default and keeps the focused launch field visible at 60×16", () => {
	const form = new LaunchForm({
		repositories: [{ id: "r", name: "Repo" }],
		defaultWorkflow: "chosen",
		workflows: [
			{ id: "other", name: "Other", allowedTriggers: ["manual"] },
			{
				id: "chosen",
				name: "Chosen",
				allowedTriggers: ["manual"],
				launchFields: [
					{ name: "prompt", label: "Task", type: "textarea", required: true },
				],
			},
		],
	});
	form.key({ name: "text", text: "Fix it" });
	form.key({ name: "tab" });
	form.key({ name: "tab" });
	form.key({ name: "text", text: "my-model" });
	const screen = new Screen(60, 16, tokens("dark").base);
	form.render(screen, tokens("dark"));
	expect(screen.cursor).toBeDefined();
	expect(screen.cursor!.y).toBeLessThan(13);
	expect(screen.cells.join("")).toContain("my-model");
	expect(form.request().body).toMatchObject({
		workflow: "chosen",
		inputs: { prompt: "Fix it" },
		model: "my-model",
	});
});

it("keeps a long focused question and its answer inside a short terminal", () => {
	const form = new AnswerForm({
		...run("questions", "waiting"),
		questions: ["word ".repeat(200), "Second question"],
		questionRecommendations: [{ questionIndex: 0, answer: "Yes" }],
	});
	form.key({ name: "text", text: "My answer" });
	const screen = new Screen(60, 16, tokens("light").base);
	form.render(screen, tokens("light"));
	expect(screen.cursor!.y).toBeLessThan(13);
	expect(screen.cells.join("")).toContain("My answer");
	form.key({ name: "tab" });
	form.key({ name: "text", text: "Second answer" });
	const next = new Screen(60, 16, tokens("light").base);
	form.render(next, tokens("light"));
	expect(next.cells.join("")).toContain("Second answer");
	expect(next.cursor!.y).toBeLessThan(13);
});

it("strips terminal control sequences from untrusted text and measures wide glyphs", () => {
	expect(sanitize("ok\x1b]52;c;cHduZWQ=\x07 \x1b[2Jdone\x07")).toBe("ok done");
	expect(width("日本😀a")).toBe(7);
	expect(wrap("one two three", 7)).toEqual(["one two", "three"]);
	const screen = new Screen(4, 1, {});
	screen.put(0, 0, "a日b");
	expect(screen.cells).toEqual(["a", "日", "", "b"]);
	screen.put(1, 0, "x");
	expect(screen.cells).toEqual(["a", "x", " ", "b"]);
});

it("edits single- and multi-line input", () => {
	const input = new TextInput("", true);
	for (const key of parseKeys("hello world")) input.handle(key);
	input.handle({ name: "ctrl-w" });
	input.handle({ name: "alt-enter" });
	input.handle({ name: "paste", text: "x\ty" });
	expect(input.value).toBe("hello \nx  y");
	const single = new TextInput();
	single.handle({ name: "paste", text: "a\nb" });
	expect(single.value).toBe("a b");
	expect(single.layout(10).cursor).toEqual({ row: 0, col: 3 });
});

it("maps the palette to xterm-256 for terminals without truecolor", () => {
	expect(ansi256("#000000")).toBe(16);
	expect(ansi256("#ffffff")).toBe(231);
	expect(ansi256("#7b61ff")).toBe(99);
});

it("resolves the dashboard port and rejects a disabled dashboard", () => {
	expect(tuiPort(undefined, {})).toBe(3457);
	expect(tuiPort(undefined, { BOBS_FACTORY_FACTORY_PORT: "4000" })).toBe(4000);
	expect(tuiPort("5000", { BOBS_FACTORY_FACTORY_PORT: "4000" })).toBe(5000);
	expect(() => tuiPort(undefined, { BOBS_FACTORY_FACTORY_PORT: "0" })).toThrow(
		"disabled",
	);
});

it("requests a new terminal session once when the server forgets it, and sends write headers", async () => {
	const seen: Record<string, string | undefined>[] = [];
	const server = createServer((request, response) => {
		seen.push({
			host: request.headers.host,
			auth: request.headers.authorization,
			origin: request.headers.origin,
			action: request.headers["x-factory-request"] as string | undefined,
		});
		const ok = request.headers.authorization === "Bearer second";
		response.writeHead(ok ? 200 : 401, { "Content-Type": "application/json" });
		response.end(JSON.stringify(ok ? { ok: true } : { error: "Sign in" }));
	});
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as AddressInfo).port;
	const tokens = ["first", "second", "third"];
	const client = new FactoryClient({
		port,
		home: "/home",
		requestSession: () => tokens.shift()!,
	});
	await expect(client.post("/api/runs/x/stop")).resolves.toEqual({ ok: true });
	expect(seen).toEqual([
		{
			host: `localhost:${port}`,
			auth: "Bearer first",
			origin: `http://localhost:${port}`,
			action: "1",
		},
		{
			host: `localhost:${port}`,
			auth: "Bearer second",
			origin: `http://localhost:${port}`,
			action: "1",
		},
	]);
	await expect(client.get("/api/runs")).resolves.toEqual({ ok: true });
	expect(seen[2]!.origin).toBeUndefined();
	tokens.push("fourth");
	server.removeAllListeners("request");
	server.on("request", (_request, response) => {
		response.writeHead(401);
		response.end("{}");
	});
	await expect(client.get("/api/runs")).rejects.toThrow("same home (/home)");
});
