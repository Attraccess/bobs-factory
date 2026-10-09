// F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/codex-context-readiness.ts
// Build workspace packages first. Inference is scripted; MCP catalogs come from the real scoped stdio helper.
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { AppServerCodexBackend } from "../../../../packages/codex-runner/dist/backend/AppServerCodexBackend.js";
import { CodexRunner } from "../../../../packages/codex-runner/dist/index.js";
import { EdgeWorker } from "../../../../packages/edge-worker/dist/EdgeWorker.js";
import { defaultWorkflows } from "../../../../packages/edge-worker/dist/factory/defaultWorkflows.js";
import { FactoryServer } from "../../../../packages/edge-worker/test/fixtures/authenticated-factory.ts";
import { MockAgentRunner } from "../../src/MockAgentRunner.ts";

const requireMcp = createRequire(
	new URL("../../../../packages/mcp-tools/package.json", import.meta.url),
);
const { Client } = requireMcp("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = requireMcp(
	"@modelcontextprotocol/sdk/client/stdio.js",
);
assert.equal(process.env.F1_AGENT_MODE, "mock");
const root = mkdtempSync(join(tmpdir(), "f1-codex-context-"));
const home = join(root, "home"),
	repository = join(root, "repo");
mkdirSync(repository);
mkdirSync(join(home, "factory"), { recursive: true });
const git = (cwd: string, ...args: string[]) =>
	execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
git(repository, "init", "-q", "-b", "main");
git(repository, "config", "user.name", "F1");
git(repository, "config", "user.email", "f1@example.test");
git(repository, "config", "commit.gpgsign", "false");
writeFileSync(join(repository, "record.txt"), "before\n");
writeFileSync(join(repository, ".gitignore"), ".claude/\n.codex/\n.agents/\n");
git(repository, "add", ".");
git(repository, "commit", "-qm", "Fixture base");
const baseSha = git(repository, "rev-parse", "HEAD");
const step = (id: string, next?: string) => ({
	id,
	name: `Context fixture ${id}`,
	type: "agent",
	runner: "codex",
	prompt: "Return the scripted fixture result",
	next,
});
const child = {
	id: "context-child",
	name: "Context child",
	allowedTriggers: ["workflow"],
	steps: [
		step("clarify", "implement"),
		step("implement", "ci"),
		step("ci", "guide"),
		step("guide", "end"),
	],
};
const parent = {
	id: "context-recovery",
	name: "Context recovery",
	labels: ["workflow:context-recovery"],
	allowedTriggers: ["ticket-assignment", "manual"],
	steps: [
		{ id: "pipeline", name: "Pipeline", type: "workflow", workflow: child.id },
	],
};
writeFileSync(
	join(home, "factory/workflows.json"),
	JSON.stringify({
		workflows: [...defaultWorkflows, child, parent],
		defaultWorkflow: parent.id,
	}),
);
process.env.BOBS_FACTORY_FACTORY_PORT = "0";
process.env.BOBS_FACTORY_DISABLE_REMOTE_SESSION_STORE = "1";
process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY = join(
	home,
	"absent-legacy-capacity",
);
const counts: Record<string, number> = {},
	turns: Record<string, number> = {},
	resumes: Record<string, (string | undefined)[]> = {};
const guide = {
	goal: "Update the fixture record",
	summary: "The record now says after.",
	tldr: "Review the updated record",
	decision: {
		status: "ready",
		summary: "Ready for fixture review",
		summaryShort: "Ready for fixture review",
	},
	scope: {
		kind: "nonvisual",
		rationale: "Only the fixture record changes",
		files: ["record.txt"],
	},
	system: {
		lanes: [
			{ id: "input", name: "Input" },
			{ id: "record", name: "Record" },
			{ id: "output", name: "Output" },
		],
		parts: [
			{ id: "record", label: "Record", laneId: "record", status: "changed" },
		],
		before: [],
		after: [],
	},
	requirements: [
		{
			criterion: "Update the record",
			status: "supported",
			evidence: ["Scripted edit committed in the isolated worktree"],
		},
	],
	chapters: [
		{
			id: "record",
			title: "Record",
			summary: "The stored record changes",
			tldr: "Read the record",
			before: "before",
			after: "after",
			beforeShort: "before",
			afterShort: "after",
			risk: { level: "low", text: "Disposable fixture" },
			keyChecks: [{ do: "Read record.txt", expect: "after" }],
			systemPartIds: ["record"],
			requirementIndexes: [0],
			files: ["record.txt"],
			screenshots: [],
			diagrams: [],
			reviewChecks: ["Read record.txt"],
			risks: [],
			evidence: ["Scripted local Git receipt"],
		},
	],
	behavior: [],
	checks: ["Scripted fixture only"],
	risks: ["No native inference or feature QA"],
	reviewInstructions: ["Inspect the record"],
};

class ScriptedClient extends EventEmitter {
	notify: ((method: string, params: unknown) => void) | undefined;
	private catalog: Record<string, unknown> = {};
	constructor(
		private mode: string,
		private attempt: number,
		private role: string,
		private workspace: string,
	) {
		super();
	}
	setNotificationHandler(fn: typeof this.notify) {
		this.notify = fn;
	}
	setServerRequestHandler() {}
	start() {}
	async close() {}
	async request(method: string, params: any) {
		const threadId = params.threadId ?? `f1-${this.role}-${this.mode}`;
		if (method === "thread/start" || method === "thread/resume") {
			assert.equal(params.config.mcp_servers["factory-context"].required, true);
			assert.equal(
				params.config.mcp_servers["factory-context"].startup_timeout_sec,
				45,
			);
			const scoped = params.config.mcp_servers["factory-context"];
			const client = new Client({ name: "f1-context-catalog", version: "1" });
			try {
				await client.connect(
					new StdioClientTransport({
						command: scoped.command,
						args: scoped.args,
					}),
				);
				this.catalog = Object.fromEntries(
					(await client.listTools()).tools.map((tool: any) => [
						tool.name,
						tool,
					]),
				);
				assert(this.catalog.list_context && this.catalog.read_context);
			} finally {
				await client.close();
			}
			return { thread: { id: threadId } };
		}
		if (method === "mcpServerStatus/list") {
			const failed =
				(this.mode === "readiness" && this.attempt === 1) ||
				(this.mode === "correction" && this.attempt === 2);
			return {
				data: [
					{
						name: "factory-context",
						runtimeStatus: failed ? "failed" : "connected",
						tools: failed ? {} : this.catalog,
					},
				],
			};
		}
		if (method === "turn/start") {
			if (this.mode !== "dirty" || this.role === "implement")
				turns[this.mode] = (turns[this.mode] ?? 0) + 1;
			if (this.mode === "dirty" && this.role === "implement") {
				if (this.attempt === 1) {
					writeFileSync(
						join(this.workspace, "record.txt"),
						"after with uncommitted work\n",
					);
					throw new Error("Scripted interruption after native initialization");
				}
				assert.equal(
					readFileSync(join(this.workspace, "record.txt"), "utf8"),
					"after with uncommitted work\n",
				);
				git(this.workspace, "add", "record.txt");
				git(
					this.workspace,
					"-c",
					"commit.gpgsign=false",
					"commit",
					"-qm",
					"Recovered fixture edit",
				);
			}
			const invalid =
				(this.mode === "exhausted" && this.attempt <= 6) ||
				(this.mode === "correction" && this.attempt === 1);
			setTimeout(() => {
				this.notify?.("turn/started", {
					threadId,
					turn: { id: "fixture-turn" },
				});
				this.notify?.("item/completed", {
					threadId,
					item: {
						type: "agentMessage",
						id: "fixture-message",
						text: JSON.stringify(
							this.role === "implement"
								? { summary: "Recovered uncommitted work" }
								: invalid
									? { ...guide, chapters: [], requirements: [] }
									: guide,
						),
					},
				});
				this.notify?.("turn/completed", {
					threadId,
					turn: { id: "fixture-turn", status: "completed" },
				});
			}, 0);
			return { turn: { id: "fixture-turn" } };
		}
		return {};
	}
}

function makeWorker() {
	const worker = new EdgeWorker({
		platform: "cli",
		factoryHome: home,
		serverHost: "127.0.0.1",
		serverPort: 3600,
		maxConcurrentSessions: 1,
		repositories: [
			{
				id: "local",
				name: "Context fixture",
				repositoryPath: repository,
				workspaceBaseDir: join(home, "worktrees"),
				baseBranch: "main",
				linearWorkspaceId: "cli-workspace",
				isActive: true,
			},
		],
		handlers: {
			createAgentRunner: (_type, config) => {
				const role = config.appendSystemPrompt?.match(
					/software-factory step: Context fixture ([^.]+)\./,
				)?.[1];
				assert(role);
				const context = JSON.parse(
					readFileSync(
						(config.mcpConfig!["factory-context"] as any).args.at(-1),
						"utf8",
					),
				);
				const mode = String(context.originalInput).match(/MODE:(\w+)/)![1];
				const key = `${mode}:${role}`;
				counts[key] = (counts[key] ?? 0) + 1;
				if (role === "guide" || (mode === "dirty" && role === "implement")) {
					if (mode === "dirty" && role === "implement")
						assert.equal(
							context.progress.currentRevision.dirty,
							counts[key]! > 1,
						);
					if (mode !== "dirty" || role === "implement") {
						resumes[mode] ??= [];
						resumes[mode].push(config.resumeSessionId);
					}
					const runner = new CodexRunner({
						...config,
						fallbackModel: undefined,
						codexHome: join(home, "codex"),
						codexPath: "/bin/true",
						skills: [],
					});
					(runner as any).createBackend = () =>
						new AppServerCodexBackend(
							() =>
								new ScriptedClient(
									mode,
									counts[key]!,
									role,
									config.workingDirectory!,
								),
						);
					return runner;
				}
				if (role === "implement") {
					writeFileSync(
						join(config.workingDirectory!, "record.txt"),
						"after\n",
					);
					git(config.workingDirectory!, "add", "record.txt");
					git(
						config.workingDirectory!,
						"-c",
						"commit.gpgsign=false",
						"commit",
						"-qm",
						"Fixture edit",
					);
				}
				const output =
					role === "clarify"
						? { questions: [], requirements: ["Update the record"] }
						: role === "ci"
							? { baseSha }
							: { summary: "Scripted record edit complete" };
				return new MockAgentRunner(config, JSON.stringify(output));
			},
		},
	});
	(worker as any).startRunTitle = () => {};
	return worker;
}
const exec = promisify(execFile);
const cli = async (...args: string[]) =>
	(
		await exec(join(import.meta.dir, "../../f1"), args, {
			env: { ...process.env, BOBS_FACTORY_PORT: "3600" },
			encoding: "utf8",
			timeout: 15000,
		})
	).stdout;
const waitFor = async (check: () => boolean) => {
	for (let i = 0; i < 600; i++) {
		try {
			if (check()) return;
		} catch (error) {
			if (!(error instanceof Error) || error.message !== "Run not found")
				throw error;
		}
		await Bun.sleep(25);
	}
	throw new Error("Fixture wait timed out");
};
let worker = makeWorker();
let server: FactoryServer;
const attach = () => {
	server = new FactoryServer((worker as any).getFactoryRuntime(), {
		repositories: () => [],
		sessions: () => [],
		entries: (id) => (worker as any).agentSessionManager.getSessionEntries(id),
		start: async () => {
			throw new Error("Launch through F1");
		},
	});
};
const read = (id: string) => (worker as any).getFactoryRuntime().get(id);
const retry = async (id: string) => {
	const response = await server.app.inject({
		method: "POST",
		url: `/api/runs/${id}/retry`,
		headers: { "x-factory-request": "1" },
	});
	assert.equal(response.statusCode, 202, response.body);
};
const restart = async () => {
	const trackers = new Map((worker as any).issueTrackers),
		sinks = new Map((worker as any).activitySinks);
	await server.stop();
	await worker.stop();
	worker = makeWorker();
	for (const [key, value] of trackers)
		(worker as any).issueTrackers.set(key, value);
	for (const [key, value] of sinks)
		(worker as any).activitySinks.set(key, value);
	await worker.start();
	attach();
};
const receipts: Record<string, unknown> = { root, counts, turns, resumes };
try {
	await worker.start();
	attach();
	await cli("ping");
	let issue = 0;
	for (const mode of ["dirty", "readiness", "correction", "exhausted"]) {
		await cli(
			"create-issue",
			"--title",
			`Context ${mode}`,
			"--description",
			`MODE:${mode}`,
			"--labels",
			"workflow:context-recovery",
		);
		await cli("start-session", "--issue-id", `issue-${++issue}`);
		const id = `session-${issue}`;
		await waitFor(() => read(id).status === "failed");
		const before = structuredClone(read(id)),
			leaf = before.checkpoint.active.children[0];
		assert.deepEqual(
			before.history.map((item: any) => item.step),
			mode === "dirty"
				? ["pipeline/clarify"]
				: ["pipeline/clarify", "pipeline/implement", "pipeline/ci"],
		);
		if (mode === "dirty") {
			assert.match(
				before.error,
				/Scripted interruption after native initialization/,
			);
			assert.equal(leaf.active.agent.sessionId, "f1-implement-dirty");
			assert.equal(turns[mode], 1);
			assert.equal(
				readFileSync(join(before.workspace, "record.txt"), "utf8"),
				"after with uncommitted work\n",
			);
		}
		if (mode === "readiness") {
			assert.equal(leaf.active.agent.sessionId, undefined);
			assert.match(
				leaf.active.agent.infrastructureFailure.reason,
				/tool discovery is unavailable/,
			);
			assert.equal(turns[mode] ?? 0, 0);
			assert.match(before.error, /Required MCP server/);
		}
		if (mode === "correction") {
			assert.equal(leaf.active.agent.rejected.attempts, 0);
			assert.equal(leaf.active.agent.rejected.reserved, false);
			assert.equal(turns[mode], 1);
		}
		if (mode === "exhausted") {
			assert.equal(leaf.active.agent.rejected.exhausted, true);
			assert.equal(leaf.active.agent.rejected.attempts, 2);
			assert.equal(turns[mode], 3);
		}
		await restart();
		assert.equal(read(id).status, "failed");
		assert.deepEqual(read(id).history, before.history);
		await retry(id);
		if (mode === "exhausted") {
			await waitFor(() => read(id).status === "failed");
			assert.equal(turns[mode], 6);
			assert.equal(
				read(id).checkpoint.active.children[0].active.agent.rejected.exhausted,
				true,
			);
			assert.deepEqual(read(id).history, before.history);
			await retry(id);
		}
		await waitFor(() => read(id).status === "completed");
		const done = read(id);
		assert.deepEqual(
			done.history.slice(0, before.history.length),
			before.history,
		);
		for (const role of ["clarify", "implement", "ci"])
			assert.equal(
				counts[`${mode}:${role}`],
				mode === "dirty" && role === "implement" ? 2 : 1,
			);
		assert.equal(done.outputs.guide.chapters.length, 1);
		assert.equal(done.outputs.guide.requirements.length, 1);
		assert.equal(done.checkpoint.active, undefined);
		if (mode === "dirty") {
			assert.equal(turns[mode], 2);
			assert.equal(
				readFileSync(join(done.workspace, "record.txt"), "utf8"),
				"after with uncommitted work\n",
			);
		}
		if (mode !== "readiness")
			assert(
				resumes[mode]!.slice(1).every(
					(id) =>
						id === `f1-${mode === "dirty" ? "implement" : "guide"}-${mode}`,
				),
			);
		if (mode === "exhausted")
			assert(
				done.events.some((event: any) =>
					event.message.includes(
						"Retry authorized another bounded output-correction cycle",
					),
				),
			);
		const activity = await server.app.inject({
			url: `/api/runs/${id}/activity?limit=120`,
		});
		assert.equal(activity.statusCode, 200);
		assert(activity.json().events.length > 0);
		writeFileSync(
			join(root, `${mode}-activities.txt`),
			await cli("view-session", "--session-id", id, "--limit", "10"),
		);
		writeFileSync(join(root, `${mode}.json`), JSON.stringify(done, null, 2));
		receipts[mode] = {
			id,
			error: before.error,
			status: done.status,
			preservedHistory: before.history.length,
		};
	}
	const capacity = await (worker as any).runnerSlots.snapshot();
	assert.equal(capacity.active, 0);
	assert.equal(capacity.queued, 0);
	console.log("F1_CONTEXT_RECOVERY_PASS", JSON.stringify(receipts));
} finally {
	await server?.stop();
	await worker.stop();
	writeFileSync(join(root, "receipts.json"), JSON.stringify(receipts, null, 2));
	console.log("EVIDENCE_ROOT", root);
}
