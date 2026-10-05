import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { validateFactoryResult } from "../src/factory/FactoryResults.js";
import {
	executeCommand,
	FactoryTools,
	filterReview,
} from "../src/factory/FactoryTools.js";
import {
	type ExecutionContext,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { providerReceipt } from "./fixtures/merge-readiness.js";

const directories: string[] = [];
it("keeps internal provider stdout quiet while preserving explicit CLI output and errors", async () => {
	const input = context();
	input.step.tool = "ci";
	input.log = vi.fn();
	const tools = new FactoryTools({
		postComment: vi.fn(),
		command: async (ctx, exe, args) => {
			const output =
				exe === "git"
					? "head"
					: args.includes("graphql")
						? JSON.stringify(providerReceipt())
						: "[[]]";
			return executeCommand(ctx, process.execPath, [
				"-e",
				"process.stdout.write(process.argv[1])",
				output,
			]);
		},
	});
	await expect(tools.tool(input)).resolves.toMatchObject({ reviewReady: true });
	expect(input.log).toHaveBeenCalledTimes(1);
	expect(input.log).toHaveBeenCalledWith(
		"Merge readiness: 1/1 checks passed; Approve the review guide to mark the PR ready; Required reviewer approval is missing",
	);
	input.step.tool = "exec";
	input.step.args = [
		process.execPath,
		"-e",
		"console.log('Visible script output')",
	];
	const cli = new FactoryTools({ postComment: vi.fn() });
	await expect(cli.tool(input)).resolves.toEqual({
		stdout: "Visible script output",
	});
	expect(input.log).toHaveBeenCalledWith("Visible script output\n");
	input.step.tool = "ci";
	await expect(
		new FactoryTools({
			postComment: vi.fn(),
			command: (ctx) =>
				executeCommand(ctx, process.execPath, [
					"-e",
					"console.error('Provider unavailable');process.exit(1)",
				]),
		}).tool(input),
	).rejects.toThrow("Provider unavailable");
});
it("runs commands with oversized input via a cleaned-up file, retaining small-input compatibility", async () => {
	const input = context();
	input.input = { detail: "x".repeat(1200000) };
	const receipt = JSON.parse(
		await executeCommand(input, process.execPath, [
			"-e",
			`
const fs = require('node:fs');
const value = JSON.parse(fs.readFileSync(process.env.FACTORY_INPUT_FILE, 'utf8'));
console.log(JSON.stringify({characters:value.detail.length, inline:process.env.FACTORY_INPUT, path:process.env.FACTORY_INPUT_FILE}));
`,
		]),
	);
	expect(receipt.characters).toBe(1200000);
	expect(receipt.inline).toBeUndefined();
	expect(existsSync(receipt.path)).toBe(false);
	input.input = { plan: "Small input" };
	expect(
		JSON.parse(
			await executeCommand(input, process.execPath, [
				"-e",
				"console.log(process.env.FACTORY_INPUT)",
			]),
		),
	).toEqual(input.input);
});
afterEach(() => {
	for (const path of directories.splice(0))
		rmSync(path, { recursive: true, force: true });
});
function home() {
	const path = mkdtempSync(join(tmpdir(), "factory-pipeline-"));
	directories.push(path);
	return path;
}

it("returns visual and CI fixes through code review, keeping dispute history", async () => {
	const order: string[] = [];
	let planReviews = 0,
		codeReviews = 0,
		visualReviews = 0,
		ci = 0;
	const runtime = new WorkflowRuntime(home(), {
		agent: async (context) => {
			const step = context.step.id;
			order.push(step);
			if (step === "clarify")
				return { questions: [], decisions: [], requirements: ["Dashboard"] };
			if (step === "plan") return { plan: "Build the dashboard", assets: [] };
			if (step === "plan-review")
				return { approved: ++planReviews > 1, feedback: [] };
			if (step === "implement") {
				expect(context.input).toEqual({
					plan: { plan: "Build the dashboard", assets: [] },
					answers: [],
				});
				return {
					status: "completed",
					summary: "Built",
					checks: [],
					questions: [],
				};
			}
			if (step === "code-review") {
				codeReviews++;
				if (codeReviews === 2)
					expect(context.run.outputs["code-fix"]).toMatchObject({
						dispositions: [{ status: "rejected" }],
					});
				return filterReview({
					summary: "Reviewed",
					findings:
						codeReviews <= 2
							? [
									{
										id: "bug",
										rating: 3,
										summary: "Failure",
										evidence: "file:1",
									},
									{
										id: "nit",
										rating: 1,
										summary: "Style",
										evidence: "file:2",
									},
								]
							: [],
				});
			}
			if (step === "code-fix")
				return {
					dispositions: [
						{ id: "bug", status: codeReviews === 1 ? "rejected" : "fixed" },
					],
				};
			if (step === "visual-scope") return { changed: true };
			if (step === "visual-review")
				return {
					findings: ++visualReviews === 1 ? [{ id: "layout", rating: 2 }] : [],
				};
			return {};
		},
		script: async () => ({}),
		tool: async (context) => {
			const step = context.step.id;
			order.push(step);
			if (step === "review-gate")
				return {
					approved:
						(context.run.outputs["code-review"] as { findings: unknown[] })
							.findings.length === 0,
				};
			if (step === "visual-gate")
				return {
					approved:
						(context.run.outputs["visual-review"] as { findings: unknown[] })
							.findings.length === 0,
				};
			if (step === "ci") return { approved: ++ci > 1, fix: ci === 1 };
			if (step === "human-review") {
				setTimeout(
					() =>
						runtime.decide(context.run.id, {
							reviewId: context.run.reviewGate!.id,
							headSha: context.run.reviewGate!.headSha,
							decision: "approve",
						}),
					0,
				);
				return {
					headSha: "test-sha",
					url: "https://github.com/test/repo/pull/1",
				};
			}
			return {};
		},
	});
	const run = runtime.create({
		triggerOrigin: {
			type: "manual",
			workflowId: "factory",
			at: new Date().toISOString(),
		},
		title: "Dashboard",
		repositoryId: "repo",
		workspace: "/tmp",
		workflow: defaultWorkflows[1]!,
		input: "Ticket",
	});
	await runtime.launch(run);
	expect(run.status).toBe("completed");
	expect(order).toEqual([
		"clarify",
		"decisions",
		"plan",
		"plan-review",
		"plan",
		"plan-review",
		"implement",
		"draft-pr",
		"code-review",
		"review-gate",
		"code-fix",
		"code-review",
		"review-gate",
		"code-fix",
		"code-review",
		"review-gate",
		"ci",
		"ci-fix",
		"after-ci-fix",
		"code-review",
		"review-gate",
		"ci",
		"visual-scope",
		"capture",
		"visual-review",
		"visual-gate",
		"visual-fix",
		"code-review",
		"review-gate",
		"ci",
		"visual-scope",
		"capture",
		"visual-review",
		"visual-gate",
		"guide",
		"handoff",
		"human-review",
		"merge",
	]);
});

function context(): ExecutionContext {
	const directory = home();
	const runtime = new WorkflowRuntime(directory, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	const run = runtime.create({
		triggerOrigin: {
			type: "manual",
			workflowId: "factory",
			at: new Date().toISOString(),
		},
		title: "Task",
		repositoryId: "repo",
		workspace: directory,
		workflow: defaultWorkflows[1]!,
		input: "Task",
	});
	run.outputs = {
		"draft-pr": { url: "https://github.com/test/repo/pull/1" },
		ci: { approved: true, headSha: "old" },
		guide: {},
	};
	return {
		run,
		step: {
			id: "handoff",
			name: "Handoff",
			type: "tool",
			tool: "handoff",
			branches: [],
			maxVisits: 8,
		},
		input: {},
		evidenceDir: directory,
		signal: new AbortController().signal,
		log: () => {},
	};
}

it("publishes with a conventional commit message instead of a raw ticket title", async () => {
	const input = context();
	input.run.title = "Power Consumption Billing\nwith clarification.";
	input.step.tool = "draft-pr";
	const command = vi.fn(
		async (_context: ExecutionContext, exe: string, args: string[]) => {
			if (exe === "git") {
				if (args[0] === "branch") return "ticket-branch";
				if (args[0] === "status") return "M  code.ts";
				if (args[0] === "rev-parse") return "head";
				if (args[0] === "rev-list") return "1";
				if (args[0] === "diff") return "code.ts";
				return "";
			}
			return JSON.stringify([
				{ url: "https://github.com/test/repo/pull/1", isDraft: true },
			]);
		},
	);
	const tools = new FactoryTools({ postComment: vi.fn(), command });
	await expect(tools.tool(input)).resolves.toMatchObject({
		branch: "ticket-branch",
		headSha: "head",
	});
	const commits = command.mock.calls.filter(
		([, exe, args]) => exe === "git" && args[0] === "commit",
	);
	expect(commits.map(([, , args]) => args)).toEqual([
		["commit", "-m", "chore: power consumption billing with clarification"],
	]);
});

it("blocks handoff when the reviewed CI revision is stale", async () => {
	const postComment = vi.fn();
	const tools = new FactoryTools({
		postComment,
		command: async (_context, exe, args) =>
			exe === "git"
				? args[0] === "status"
					? ""
					: "new"
				: JSON.stringify({ headRefOid: "new", isDraft: true, state: "OPEN" }),
	});
	await expect(tools.tool(context())).rejects.toThrow(
		"revision or CI evidence",
	);
	expect(postComment).not.toHaveBeenCalled();
});

it("rechecks live CI before handing a draft PR to a human", async () => {
	const input = context();
	(input.run.outputs.ci as { headSha: string }).headSha = "head";
	const postComment = vi.fn();
	const tools = new FactoryTools({
		postComment,
		command: async (_context, exe, args) => {
			if (exe === "git") return args[0] === "status" ? "" : "head";
			if (args.includes("graphql"))
				return JSON.stringify(
					providerReceipt({
						statusCheckRollup: {
							contexts: {
								nodes: [{ name: "test", conclusion: "FAILURE" }],
								pageInfo: {},
							},
						},
					}),
				);
			if (args[0] === "api") return "[[]]";
			return args[1] === "view"
				? JSON.stringify({ headRefOid: "head", isDraft: true, state: "OPEN" })
				: JSON.stringify([{ bucket: "fail" }]);
		},
	});
	await expect(tools.tool(input)).rejects.toThrow("Merge readiness changed");
	expect(postComment).not.toHaveBeenCalled();
});

it("publishes a grounded human review guide while keeping the PR draft", async () => {
	const input = context();
	input.run.outputs.ci = { approved: true, headSha: "head" };
	input.run.outputs.guide = {
		goal: "Dashboard",
		summary: "Built",
		decision: { status: "ready", summary: "Checks passed" },
		behavior: [{ scenario: "Load", before: "Blank", after: "Dashboard" }],
		requirements: [
			{
				criterion: "Displays runs",
				status: "supported",
				evidence: ["Browser drive"],
			},
		],
		checks: ["CI passed"],
		risks: ["Human review required"],
		reviewInstructions: ["Open dashboard"],
	};
	const commands: string[][] = [];
	const postComment = vi.fn();
	const tools = new FactoryTools({
		postComment,
		command: async (_context, exe, args) => {
			commands.push([exe, ...args]);
			if (exe === "git") return args[0] === "status" ? "" : "head";
			if (args[1] === "view")
				return JSON.stringify({
					headRefOid: "head",
					isDraft: true,
					state: "OPEN",
				});
			if (args.includes("graphql")) return JSON.stringify(providerReceipt());
			if (args[0] === "api") return "[[]]";
			if (args[1] === "checks") return JSON.stringify([{ bucket: "pass" }]);
			return "";
		},
	});
	expect(await tools.tool(input)).toEqual({
		url: "https://github.com/test/repo/pull/1",
		headSha: "head",
		ready: true,
	});
	expect(commands.at(-1)?.slice(0, 5)).toEqual([
		"gh",
		"pr",
		"edit",
		"https://github.com/test/repo/pull/1",
		"--body",
	]);
	expect(postComment).toHaveBeenCalledOnce();
	expect(
		commands.some(
			(command) => command.includes("ready") || command.includes("merge"),
		),
	).toBe(false);
});

it("waits on blocked implementation across restart and supplies the answer without leaking the ticket", async () => {
	const directory = home();
	const plan = { plan: "Backlog only; do not implement yet.", assets: [] };
	const question = "Should implementation proceed now, or remain backlog only?";
	const agents = vi.fn(async (context: ExecutionContext) => {
		if (context.step.id === "clarify")
			return { questions: [], decisions: [], requirements: ["Installation"] };
		if (context.step.id === "plan") return plan;
		if (context.step.id === "plan-review")
			return { approved: true, feedback: [] };
		expect(context.input).toEqual({ plan, answers: [] });
		return validateFactoryResult("implement", {
			status: "blocked",
			summary: "Implementation deferred by the plan.",
			checks: ["Worktree clean"],
			questions: [question],
		});
	});
	const tool = vi.fn(async () => ({}));
	const runtime = new WorkflowRuntime(directory, {
		agent: agents,
		tool,
		script: async () => ({}),
	});
	const run = runtime.create({
		triggerOrigin: {
			type: "manual",
			workflowId: "factory",
			at: new Date().toISOString(),
		},
		title: "Backlog installation",
		repositoryId: "repo",
		workspace: directory,
		workflow: defaultWorkflows[1]!,
		input: "Private ticket and metadata",
	});
	const first = runtime.launch(run);
	await vi.waitFor(() => expect(run.status).toBe("waiting"));
	expect(run.step).toBe("pipeline/implement");
	expect(run.questions).toEqual([question]);
	expect(tool).toHaveBeenCalledTimes(1); // Decision recording only; no delivery.
	await runtime.shutdown();
	await first;
	const retained = structuredClone(run.history);
	const published = vi.fn();
	const resumedAgent = vi.fn(async (context: ExecutionContext) => {
		expect(context.input).toEqual({
			plan,
			answers: [
				{
					questions: [question],
					answer: "Proceed with implementation now.",
					at: expect.any(String),
				},
			],
		});
		return validateFactoryResult("implement", {
			status: "completed",
			summary: "Implemented after authorization.",
			checks: ["Tests passed"],
			questions: [],
		});
	});
	const restarted = new WorkflowRuntime(directory, {
		agent: resumedAgent,
		script: async () => ({}),
		tool: async (context) => {
			published(context.step.id);
			throw new Error("End fixture after delivery checkpoint");
		},
	});
	const restored = restarted.get(run.id);
	const second = restarted.launch(restored);
	await vi.waitFor(() => expect(restored.status).toBe("waiting"));
	expect(resumedAgent).not.toHaveBeenCalled();
	restarted.answer(run.id, "Proceed with implementation now.");
	await second;
	expect(resumedAgent).toHaveBeenCalledTimes(1);
	expect(published).toHaveBeenCalledExactlyOnceWith("draft-pr");
	expect(restored.history.slice(0, retained.length)).toEqual(retained);
});

it("rejects implementation reports that cannot distinguish completion from a blocker", () => {
	const report = {
		summary: "Implementation deferred; no files changed.",
		checks: [],
	};
	expect(() => validateFactoryResult("implement", report)).toThrow();
	expect(() =>
		validateFactoryResult("implement", {
			...report,
			status: "blocked",
			questions: [],
		}),
	).toThrow();
	expect(() =>
		validateFactoryResult("implement", {
			...report,
			status: "completed",
			questions: ["Need access"],
		}),
	).toThrow();
});

it("refuses to publish an empty branch or empty commit before invoking GitHub", async () => {
	const input = context();
	input.step.tool = "draft-pr";
	input.run.outputs.repository = { baseBranch: "main" };
	input.run.outputs.implement = {
		summary: "Implementation deferred: backlog only.",
	};
	const remote = join(input.evidenceDir, "remote.git");
	input.run.workspace = join(input.evidenceDir, "repo");
	mkdirSync(input.run.workspace);
	const git = (...args: string[]) =>
		execFileSync("git", args, {
			cwd: input.run.workspace,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	git("init", "-b", "main");
	git("config", "user.name", "Factory fixture");
	git("config", "user.email", "factory@example.test");
	writeFileSync(join(input.run.workspace, "feature.txt"), "Baseline\n");
	git("add", "feature.txt");
	git("commit", "-m", "Baseline");
	git("init", "--bare", remote);
	git("remote", "add", "origin", remote);
	git("push", "origin", "main");
	git("switch", "-c", "factory-fixture");
	const command = vi.fn(
		async (context: ExecutionContext, executable: string, args: string[]) => {
			if (executable !== "git" || args[0] === "push")
				throw new Error("Unexpected publication");
			return executeCommand(context, executable, args);
		},
	);
	const tools = new FactoryTools({ postComment: vi.fn(), command });
	await expect(tools.tool(input)).rejects.toThrow(
		"No implementation changes to publish against main. Implementation deferred: backlog only.",
	);
	git("commit", "--allow-empty", "-m", "Empty implementation");
	await expect(tools.tool(input)).rejects.toThrow(
		"No implementation changes to publish",
	);
	expect(
		command.mock.calls.every(
			([, exe, args]) => exe === "git" && args[0] !== "push",
		),
	).toBe(true);
});

it("never publishes partial work from a blocked implementation, even for a legacy workflow", async () => {
	const input = context();
	input.step.tool = "draft-pr";
	input.run.outputs.implement = {
		status: "blocked",
		summary: "Missing access after partial implementation",
		questions: ["Supply access"],
	};
	const command = vi.fn();
	await expect(
		new FactoryTools({ postComment: vi.fn(), command }).tool(input),
	).rejects.toThrow("Implementation is blocked: Missing access");
	expect(command).not.toHaveBeenCalled();
});
