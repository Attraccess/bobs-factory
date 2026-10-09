// F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/tui-inbox.ts [--serve]
// Real EdgeWorker, Git worktrees, auth/API/SSE and TodayApp; only agents are mocked.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TodayApp } from "../../../../apps/cli/src/tui/app.js";
import { FactoryClient } from "../../../../apps/cli/src/tui/client.js";
import { sanitize } from "../../../../apps/cli/src/tui/terminal.js";
import { sgrFor } from "../../../../apps/cli/src/tui/theme.js";
import {
	EdgeWorker,
	requestFactoryTerminalSession,
} from "../../../../packages/edge-worker/dist/index.js";
import { f1AgentHandlers } from "../../src/MockAgentRunner.js";

assert.equal(process.env.F1_AGENT_MODE, "mock");
const directory = realpathSync(mkdtempSync(join(tmpdir(), "f1-tui-inbox-")));
const home = join(directory, "home");
const repo = join(directory, "repo");
mkdirSync(home);
mkdirSync(repo);
const git = (...args: string[]) =>
	execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: "pipe" });
git("init", "-q", "-b", "main");
git("config", "user.name", "F1 fixture");
git("config", "user.email", "f1@example.invalid");
writeFileSync(join(repo, "README.md"), "# TUI fixture\n");
git("add", ".");
git("-c", "commit.gpgsign=false", "commit", "-qm", "Initial fixture");
git("remote", "add", "origin", repo);
const port = Number(process.env.F1_TUI_PORT ?? 3641);
process.env.BOBS_FACTORY_FACTORY_PORT = String(port);
process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY = join(
	directory,
	"legacy-capacity",
);
delete process.env.BOBS_FACTORY_FACTORY_ORIGIN;
delete process.env.BOBS_FACTORY_FACTORY_PUBLIC_ORIGIN;
const questions = ["Which theme should be the default?"];
const recommendations = [
	{ questionIndex: 0, answer: "Automatic", reason: "Match the terminal." },
];
const worker = new EdgeWorker({
	platform: "cli",
	factoryHome: home,
	serverPort: port + 1,
	serverHost: "127.0.0.1",
	defaultRunner: "codex",
	handlers: {
		...f1AgentHandlers("mock"),
		createAgentRunner: (type, config) => {
			const context = config.mcpConfig?.["factory-context"];
			const input =
				context && "args" in context
					? JSON.parse(readFileSync(context.args![1]!, "utf8"))
					: undefined;
			const output =
				input && !input.answers?.length
					? {
							questions,
							questionRecommendations: recommendations,
							decisions: [],
							requirements: [],
						}
					: {
							questions: [],
							questionRecommendations: [],
							decisions: [],
							requirements: [],
							summary: "F1 terminal run completed",
						};
			return f1AgentHandlers("mock", JSON.stringify(output))!
				.createAgentRunner!(type, config);
		},
	},
	repositories: [
		{
			id: "fixture",
			name: "TUI fixture",
			repositoryPath: repo,
			workspaceBaseDir: join(directory, "worktrees"),
			baseBranch: "main",
			linearWorkspaceId: "cli-workspace",
			isActive: true,
		},
	],
});
const runtime = (worker as any).getFactoryRuntime();
let frame = "";
let columns = 100;
let rows = 30;
let app: TodayApp | undefined;
const client = new FactoryClient({
	port,
	home,
	requestSession: requestFactoryTerminalSession,
});
async function until<T>(check: () => T): Promise<NonNullable<T>> {
	const deadline = Date.now() + 15000;
	while (Date.now() < deadline) {
		const value = check();
		if (value) return value as NonNullable<T>;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(`Timed out. Last frame: ${sanitize(frame)}`);
}
const key = (name: string, text?: string) => app!.key({ name, text });
const visible = () => sanitize(frame);
const capture = (name: string) =>
	writeFileSync(join(directory, `${name}.ansi`), frame);
try {
	await worker.start();
	runtime.updateWorkflows(
		[
			...runtime.listWorkflows(),
			{
				id: "tui-smoke",
				name: "Terminal smoke",
				allowedTriggers: ["manual"],
				steps: [
					{
						id: "clarify",
						name: "Clarify",
						type: "agent",
						askQuestions: true,
						prompt: "Ask about the theme, then finish.",
					},
				],
			},
			{
				id: "tui-stop",
				name: "Stop smoke",
				allowedTriggers: ["manual"],
				steps: [
					{
						id: "hold",
						name: "Hold for stop",
						type: "script",
						computeIntensive: false,
						script: "node -e 'setTimeout(() => {}, 60000)'",
					},
				],
			},
		],
		"tui-smoke",
	);
	const unauthenticated = await fetch(`http://localhost:${port}/api/runs`);
	assert.equal(unauthenticated.status, 401);
	app = new TodayApp({
		client,
		theme: "dark",
		sgr: sgrFor(true),
		write: (next) => {
			frame = next;
		},
		size: () => ({ columns, rows }),
		openUrl: async () => {},
		quit: () => app!.stop(),
	});
	app.start();
	await until(
		() => visible().includes("Inbox zero") && visible().includes("● live"),
	);
	key("text", "n");
	key("text", "Build a terminal theme toggle");
	key("ctrl-s");
	const run = (await until(() =>
		[...runtime.runs.values()].find((item: any) => item.status === "waiting"),
	)) as any;
	await until(
		() => visible().includes(questions[0]) && visible().includes("Automatic"),
	);
	assert.notEqual(run.workspace, repo);
	assert.equal(run.workflow.id, "tui-smoke");
	assert.deepEqual(run.answers, []);
	capture("dark-question");
	key("escape");
	key("text", "t");
	key("ctrl-k");
	key("text", run.id);
	await until(() => visible().includes("Switch run"));
	key("enter");
	await until(() => visible().includes("Today › Run"));
	key("text", "a");
	columns = 60;
	rows = 16;
	app.render();
	assert(visible().includes("Automatic"));
	capture("light-short-answer");
	key("text", "Dark");
	key("ctrl-s");
	await until(() => runtime.get(run.id).status === "completed");
	await until(() => visible().includes("Finished"));
	assert.equal(runtime.get(run.id).answers.length, 1);
	assert.match(runtime.get(run.id).answers[0].answer, /Dark/);
	columns = 100;
	rows = 30;
	key("ctrl-r");
	await until(() =>
		visible().replace(/\s+/g, " ").includes("F1 terminal run completed"),
	);
	capture("light-completed");
	key("text", "s");
	await until(
		() =>
			runtime.viewState(run.id)?.settledAt && !visible().includes("Working…"),
	);
	key("escape");
	await until(() => visible().includes("Inbox zero"));
	key("text", "S");
	await until(() => visible().includes("Settled by you"));
	key("ctrl-k");
	key("text", run.id);
	key("enter");
	await until(() => visible().includes("Today › Run"));
	key("text", "s");
	await until(
		() =>
			runtime.viewState(run.id)?.keptOpen && !visible().includes("Working…"),
	);
	const stopping = await client.post<any>("/api/runs", {
		repositoryId: "fixture",
		workflow: "tui-stop",
		inputs: { prompt: "Stop me" },
	});
	await until(
		() =>
			runtime.get(stopping.id)?.status === "running" &&
			runtime.get(stopping.id)?.step === "hold",
	);
	key("ctrl-r");
	key("ctrl-k");
	key("text", stopping.id);
	await until(
		() =>
			visible().includes("Switch run") &&
			!visible().includes("No matching runs"),
	);
	key("enter");
	await until(() => visible().includes(stopping.id));
	key("text", "x");
	assert(visible().includes("Confirm"));
	key("text", "y");
	await until(() => runtime.get(stopping.id)?.status === "stopped");
	assert.equal(
		(await client.get<any[]>("/api/runs")).find(
			(item) => item.id === stopping.id,
		)?.status,
		"stopped",
	);
	writeFileSync(
		join(directory, "result.json"),
		JSON.stringify(
			{
				home,
				port,
				run: run.id,
				stopping: stopping.id,
				assertions: [
					"unauthenticated denied",
					"local session accepted",
					"SSE live",
					"keyboard launch with saved recipe",
					"isolated worktree",
					"question requires submission",
					"light/dark",
					"Ctrl-K filtering",
					"short-terminal answer",
					"explicit answer continues",
					"activity rendered",
					"settle and reopen",
					"keyboard stop with confirmation",
				],
				mode: "mock",
			},
			null,
			2,
		),
	);
	console.log(`PASS: TUI inbox F1 drive; evidence=${directory}`);
	if (process.argv.includes("--serve")) {
		app.stop();
		console.log(`PTY_READY home=${home} port=${port}`);
		await new Promise<void>((resolve) => {
			process.once("SIGTERM", resolve);
			process.once("SIGINT", resolve);
		});
	}
} finally {
	app?.stop();
	await worker.stop();
}
