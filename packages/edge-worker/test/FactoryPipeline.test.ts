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
	captureEvidence,
	executeCommand,
	FactoryTools,
	filterReview,
} from "../src/factory/FactoryTools.js";
import { roleProgress } from "../src/factory/Incremental.js";
import { qaDigest } from "../src/factory/Qa.js";
import {
	type ExecutionContext,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { providerReceipt } from "./fixtures/merge-readiness.js";
import { qaExecution, qaScope } from "./fixtures/qa.js";

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

it.each([
	false,
	true,
])("recovers missing visual evidence across restart and legacy Retry (legacy=%s)", async (legacy) => {
	const directory = home();
	const workspace = join(directory, "repo");
	mkdirSync(workspace);
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: workspace, encoding: "utf8" }).trim();
	git("init", "-b", "main");
	git("config", "user.name", "Fixture");
	git("config", "user.email", "fixture@example.test");
	git("config", "commit.gpgsign", "false");
	writeFileSync(join(workspace, "view.txt"), "Unchanged view");
	git("add", ".");
	git("commit", "-m", "chore: fixture");
	const tools = new FactoryTools({ postComment: vi.fn() });
	const questionPosted = vi.fn();
	const agents = vi.fn(async (ctx: ExecutionContext) => {
		if (ctx.step.id === "visual-review") {
			const capture = ctx.run.outputs.capture as { screenshots: unknown[] };
			// Even an incorrectly approving reviewer cannot bypass missing captures.
			return {
				findings: [],
				summary: "Web accepted",
				acceptedScreenshots: capture.screenshots,
			};
		}
		ctx.progress = await roleProgress(ctx);
		const previous = ctx.progress.previousOutput as
			| { screenshots: { path: string; area: string; state: string }[] }
			| undefined;
		const image = (name: string, area: string, byte: number) => {
			const path = join(ctx.evidenceDir, name);
			writeFileSync(path, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, byte]));
			return { path, caption: area, area, state: "desktop" };
		};
		const answered = ctx.run.answers.length > 0;
		const output = captureEvidence(ctx, {
			screenshots: previous?.screenshots ?? [image("web.png", "Web", 1)],
			unavailable: [{ area: "Reader", reason: "Test-card login timed out" }],
		});
		if (answered) {
			expect((ctx.input as { answers: unknown[] }).answers).toHaveLength(1);
			const prior = previous!.screenshots;
			const complete = captureEvidence(ctx, {
				screenshots: [...prior, image("reader.png", "Reader", 2)],
				unavailable: [],
			});
			ctx.run.roleRevisions![ctx.run.step!] = ctx.progress.currentRevision!;
			return complete;
		}
		ctx.run.roleRevisions ??= {};
		ctx.run.roleRevisions[ctx.run.step!] = ctx.progress.currentRevision!;
		return output;
	});
	const hooks = {
		agent: agents,
		script: async () => ({}),
		tool: (ctx: ExecutionContext) => tools.tool(ctx),
		question: questionPosted,
	};
	const runtime = new WorkflowRuntime(directory, hooks);
	const definitions = runtime.listWorkflows();
	const pipeline = definitions.find((w) => w.id === "factory-pipeline")!;
	pipeline.steps = pipeline.steps.filter((s) =>
		["capture", "visual-review", "visual-gate"].includes(s.id),
	);
	// These fixtures deliberately exercise frozen screenshot-only run recovery.
	for (const step of pipeline.steps) delete step.qaContract;
	pipeline.steps.at(-1)!.next = "end";
	pipeline.steps.at(-1)!.branches = [];
	pipeline.steps[0]!.inputs = ["visual-scope"];
	const run = runtime.create({
		triggerOrigin: {
			type: "manual",
			workflowId: "factory",
			at: new Date().toISOString(),
		},
		title: "Recover reader captures",
		repositoryId: "repo",
		workspace,
		workflow: definitions.find((w) => w.id === "factory")!,
		workflowDefinitions: definitions,
		input: "Capture fixture",
	});
	run.outputs["visual-scope"] = {
		changed: true,
		areas: ["Web", "Reader"].map((name) => ({
			name,
			states: ["desktop"],
			dependencies: ["view.txt"],
		})),
	};
	const first = runtime.launch(run);
	await vi.waitFor(() => expect(run.status).toBe("waiting"));
	expect(run.step).toBe("pipeline/visual-gate");
	expect(run.questions.join("\n")).toContain("Test-card login timed out");
	expect(questionPosted).toHaveBeenCalledTimes(1);
	expect(agents).toHaveBeenCalledTimes(2);
	const frozen = structuredClone(run.workflowDefinitions);
	await runtime.shutdown();
	await first;
	if (legacy) {
		run.status = "failed";
		run.error =
			"Visual evidence is incomplete. Supply capture tools/access and start a new run; screenshots cannot be approved without evidence.";
		run.questions = [];
		run.history.pop(); // The old gate threw before producing a receipt.
		delete run.outputs["visual-gate"];
		run.checkpoint!.active!.children![0]!.active = { phase: "executing" };
		runtime.save(run);
		questionPosted.mockClear();
	}
	const restarted = new WorkflowRuntime(directory, hooks);
	if (legacy) restarted.retry(run.id);
	else restarted.resumeAll();
	const restored = restarted.get(run.id);
	await vi.waitFor(() => expect(restored.status).toBe("waiting"));
	expect(agents).toHaveBeenCalledTimes(2);
	expect(questionPosted).toHaveBeenCalledTimes(1);
	expect(restored.error).toBeUndefined();
	const retained = structuredClone(restored.history);
	restarted.answer(run.id, "The test card now works; capture Reader desktop.");
	await vi.waitFor(() => expect(restored.status).toBe("completed"));
	expect(restored.history.slice(0, retained.length)).toEqual(retained);
	expect(restored.workflowDefinitions).toEqual(frozen);
	expect(restored.history.slice(retained.length).map((h) => h.step)).toEqual([
		"pipeline/capture",
		"pipeline/visual-review",
		"pipeline/visual-gate",
		"pipeline",
	]);
	expect(restored.outputs.capture).toMatchObject({
		screenshots: [
			{ area: "Web", reused: true },
			{ area: "Reader", reused: false },
		],
		unavailable: [],
	});
	expect(restored.outputs["visual-gate"]).toMatchObject({ approved: true });
});

it("offers capture assistance when selected states are missing even without an unavailable report", async () => {
	const ctx = context();
	ctx.step.tool = "visual-gate";
	ctx.run.outputs["visual-review"] = { findings: [], summary: "No findings" };
	const path = join(ctx.evidenceDir, "web.png");
	writeFileSync(path, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]));
	ctx.run.outputs.capture = {
		screenshots: [{ path, caption: "Web", area: "Web", state: "desktop" }],
		unavailable: [],
	};
	ctx.run.outputs["visual-scope"] = {
		areas: [{ name: "Reader", states: ["owner", "meters"] }],
	};
	await expect(
		new FactoryTools({ postComment: vi.fn() }).tool(ctx),
	).resolves.toMatchObject({
		approved: false,
		captureBlocked: true,
		questions: [
			expect.stringContaining(
				"Reader: No screenshot supplied for states: owner; meters",
			),
		],
	});
});

it("waits again when capture remains blocked after an answer, and stops without handoff", async () => {
	const directory = home();
	const tools = new FactoryTools({ postComment: vi.fn() });
	const handoff = vi.fn();
	const runtime = new WorkflowRuntime(directory, {
		agent: async (ctx) =>
			ctx.step.id === "capture"
				? {
						screenshots: [],
						unavailable: [{ area: "Reader", reason: "Login still fails" }],
					}
				: { findings: [], summary: "No screenshots" },
		script: async () => {
			handoff();
			return {};
		},
		tool: (ctx) => tools.tool(ctx),
	});
	const definitions = runtime.listWorkflows();
	const pipeline = definitions.find((w) => w.id === "factory-pipeline")!;
	pipeline.steps = pipeline.steps.filter((s) =>
		["capture", "visual-review", "visual-gate"].includes(s.id),
	);
	// These fixtures deliberately exercise frozen screenshot-only run recovery.
	for (const step of pipeline.steps) delete step.qaContract;
	pipeline.steps.at(-1)!.branches = [];
	pipeline.steps.at(-1)!.next = "delivery";
	pipeline.steps.push({
		id: "delivery",
		name: "Handoff must not happen",
		type: "script",
		script: "exit 1",
		maxVisits: 1,
		branches: [],
	});
	const run = runtime.create({
		triggerOrigin: {
			type: "manual",
			workflowId: "factory",
			at: new Date().toISOString(),
		},
		title: "Repeated blocker",
		repositoryId: "repo",
		workspace: directory,
		workflow: definitions.find((w) => w.id === "factory")!,
		workflowDefinitions: definitions,
		input: "Fixture",
	});
	const execution = runtime.launch(run);
	await vi.waitFor(() => expect(run.status).toBe("waiting"));
	runtime.answer(run.id, "Approve it anyway.");
	await vi.waitFor(() => {
		expect(run.status).toBe("waiting");
		expect(
			run.history.filter((h) => h.step === "pipeline/capture"),
		).toHaveLength(2);
	});
	expect(run.outputs["visual-gate"]).toMatchObject({
		approved: false,
		captureBlocked: true,
	});
	expect(run.questions.join("\n")).toContain("Login still fails");
	runtime.stop(run.id);
	await execution;
	expect(run.status).toBe("stopped");
	expect(handoff).not.toHaveBeenCalled();
});

it("fails safely when a custom visual gate has no capture recovery path", async () => {
	const ctx = context();
	const gate = {
		...ctx.step,
		id: "visual-gate",
		tool: "visual-gate",
		next: "end",
	};
	ctx.run.workflow.steps = [gate];
	ctx.run.outputs.capture = { screenshots: [], unavailable: [] };
	ctx.run.outputs["visual-review"] = {
		findings: [],
		summary: "No screenshots",
	};
	const tools = new FactoryTools({ postComment: vi.fn() });
	const question = vi.fn();
	const runtime = new WorkflowRuntime(ctx.evidenceDir, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: (input) => tools.tool(input),
		question,
	});
	await runtime.launch(ctx.run);
	expect(ctx.run.status).toBe("failed");
	expect(ctx.run.error).toContain(
		"no capture → visual-review → visual-gate recovery path",
	);
	expect(question).not.toHaveBeenCalled();
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

function qaContext(surface: "ui" | "api" | "cli" = "api") {
	const ctx = context();
	ctx.step = {
		...ctx.step,
		id: "visual-gate",
		tool: "visual-gate",
		qaContract: "qa-v1",
	};
	ctx.run.step = "visual-gate";
	ctx.run.outputs.clarify = {
		requirements: ["Persist a record"],
		decisions: [],
	};
	ctx.run.outputs["visual-scope"] = qaScope(surface);
	ctx.run.roleRevisions = Object.fromEntries(
		["visual-scope", "capture", "visual-review"].map((id) => [
			id,
			{ headSha: "head", dirty: false, at: "now", historyLength: 0 },
		]),
	);
	ctx.progress = {
		visit: 1,
		changedFiles: [],
		unchangedCode: false,
		uncertain: true,
		newHistory: [],
		currentRevision: {
			headSha: "head",
			dirty: false,
			at: "now",
			historyLength: 0,
		},
	};
	return ctx;
}
function stampQa(ctx: ExecutionContext, output = qaExecution()) {
	const captureStep = { ...ctx.step, id: "capture" };
	ctx.run.outputs.capture = captureEvidence(
		{ ...ctx, step: captureStep },
		output,
	);
	ctx.run.outputs["visual-review"] = {
		qaContract: "qa-v1",
		findings: [],
		summary: "Reviewed executed receipts",
		acceptedScreenshots: [],
		qaReviewStamp: {
			headSha: "head",
			dirty: false,
			scopeHash: qaDigest(ctx.run.outputs["visual-scope"]),
			captureHash: qaDigest(ctx.run.outputs.capture),
		},
	};
}
const qaTools = () =>
	new FactoryTools({
		postComment: vi.fn(),
		command: async (_ctx, _exe, args) => (args[0] === "status" ? "" : "head"),
	});

it.each([
	"api",
	"cli",
] as const)("allows executed %s QA with no screenshots and retains optional observations", async (surface) => {
	const ctx = qaContext(surface);
	const capture = qaExecution();
	capture.observations = [
		{
			id: "help",
			summary: "Optional clearer help",
			evidence: "Observed current wording",
		},
	];
	stampQa(ctx, capture);
	await expect(qaTools().tool(ctx)).resolves.toMatchObject({
		approved: true,
		observations: capture.observations,
	});
	expect(
		(ctx.run.outputs.capture as typeof capture).testedRevision?.headSha,
	).toBe("head");
});
it("generates an actionable stable QA finding when a reviewer approves failed behavior, then requires retesting", async () => {
	const ctx = qaContext();
	stampQa(ctx, qaExecution("failed"));
	const first = (await qaTools().tool(ctx)) as {
		approved: boolean;
		findings: { id: string; reproduction: string[] }[];
	};
	expect(first.approved).toBe(false);
	expect(first.findings[0].reproduction).toEqual(["Save a valid record"]);
	stampQa(ctx, qaExecution("failed"));
	expect(await qaTools().tool(ctx)).toMatchObject({
		approved: false,
		findings: [{ id: first.findings[0].id }],
	});
	stampQa(ctx, qaExecution());
	await expect(qaTools().tool(ctx)).resolves.toMatchObject({ approved: true });
});
it("keeps independently reported consequential findings blocking even when all criteria pass", async () => {
	const ctx = qaContext(),
		capture = qaExecution();
	capture.findings.push({
		id: "data-loss",
		rating: 2,
		status: "open",
		summary: "Lost neighboring data",
		evidence: "Readback lost existing record",
		storyId: "save",
		criterionId: "saved",
		requirementRefs: ["requirements/0"],
		reproduction: ["Save"],
		expected: "Existing records retained",
		actual: "Record missing",
	});
	stampQa(ctx, capture);
	await expect(qaTools().tool(ctx)).resolves.toMatchObject({
		approved: false,
		findings: [{ id: "data-loss" }],
	});
});
it("requests assistance for blocked, missing, mismatched or stale QA rather than approving", async () => {
	const ctx = qaContext();
	stampQa(ctx, qaExecution("blocked"));
	await expect(qaTools().tool(ctx)).resolves.toMatchObject({
		approved: false,
		qaBlocked: true,
		questions: [expect.stringContaining("Test account unavailable")],
	});
	const absent = qaExecution();
	absent.results = [];
	stampQa(ctx, absent);
	await expect(qaTools().tool(ctx)).resolves.toMatchObject({
		approved: false,
		qaBlocked: true,
	});
	stampQa(ctx);
	(
		ctx.run.outputs["visual-scope"] as ReturnType<typeof qaScope>
	).stories[0].criteria[0].expected = "Changed criterion";
	await expect(qaTools().tool(ctx)).resolves.toMatchObject({
		approved: false,
		qaBlocked: true,
	});
	ctx.run.outputs["visual-scope"] = qaScope();
	stampQa(ctx);
	ctx.run.roleRevisions!.capture!.headSha = "old";
	await expect(qaTools().tool(ctx)).resolves.toMatchObject({
		approved: false,
		qaBlocked: true,
	});
});
it("requires selected UI screenshots and exact inspected-image receipts, rejecting unknown tasks", async () => {
	const ctx = qaContext("ui");
	execFileSync("git", ["init", "-q"], { cwd: ctx.run.workspace });
	writeFileSync(join(ctx.run.workspace, "view.ts"), "fixture");
	stampQa(ctx);
	await expect(qaTools().tool(ctx)).resolves.toMatchObject({
		approved: false,
		captureBlocked: true,
	});
	const path = join(ctx.evidenceDir, "saved.png");
	writeFileSync(path, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]));
	const capture = qaExecution();
	capture.screenshots.push({
		path,
		caption: "Saved",
		area: "Editor",
		state: "saved",
	});
	stampQa(ctx, capture);
	await expect(qaTools().tool(ctx)).resolves.toMatchObject({
		approved: false,
		qaBlocked: true,
	});
	const stamped = ctx.run.outputs.capture as typeof capture;
	(
		ctx.run.outputs["visual-review"] as { acceptedScreenshots: unknown[] }
	).acceptedScreenshots = stamped.screenshots.map((s) => ({
		area: s.area,
		state: s.state,
		imageSha256: s.imageSha256,
	}));
	await expect(qaTools().tool(ctx)).resolves.toMatchObject({ approved: true });
	capture.screenshots[0].state = "unplanned";
	expect(() => stampQa(ctx, capture)).toThrow("Unknown screenshot task");
});
it("requires the versioned QA fields while preserving screenshot-only legacy result validation", () => {
	const legacy = { screenshots: [], unavailable: [] };
	expect(validateFactoryResult("capture", legacy)).toMatchObject(legacy);
	expect(() => validateFactoryResult("capture", legacy, "qa-v1")).toThrow();
	expect(() =>
		validateFactoryResult(
			"visual-scope",
			{ changed: false, areas: [] },
			"qa-v1",
		),
	).toThrow();
	const scope = qaScope();
	scope.stories.push(scope.stories[0]);
	expect(() => validateFactoryResult("visual-scope", scope, "qa-v1")).toThrow(
		"unique",
	);
});

it("routes a confirmed product failure preventing a screenshot to fixes, keeping unconfirmed capture gaps blocked", async () => {
	const ctx = qaContext("ui"),
		failed = qaExecution("failed");
	failed.unavailable = [
		{
			area: "Editor",
			reason: "Failed save never reaches success view",
			cause: "product",
		},
	];
	stampQa(ctx, failed);
	await expect(qaTools().tool(ctx)).resolves.toMatchObject({
		approved: false,
		findings: [expect.objectContaining({ rating: 3 })],
	});
	expect(await qaTools().tool(ctx)).not.toHaveProperty("qaBlocked");
	const passed = qaExecution();
	passed.unavailable = failed.unavailable;
	stampQa(ctx, passed);
	await expect(qaTools().tool(ctx)).resolves.toMatchObject({
		approved: false,
		qaBlocked: true,
	});
});

it("allows fresh clean execution after fixture preparation while retaining the unchanged accepted scope", async () => {
	const ctx = qaContext();
	ctx.run.roleRevisions!["visual-scope"] = {
		headSha: "fixture-before",
		dirty: true,
		at: "before",
		historyLength: 0,
	};
	stampQa(ctx);
	await expect(qaTools().tool(ctx)).resolves.toMatchObject({ approved: true });
});
it("blocks handoff when a previously approved QA artifact changes", async () => {
	const ctx = qaContext();
	stampQa(ctx);
	ctx.run.outputs["visual-gate"] = await qaTools().tool(ctx);
	ctx.step = { ...ctx.step, id: "handoff", tool: "handoff" };
	ctx.run.step = "handoff";
	ctx.run.outputs.ci = { approved: true, headSha: "head" };
	ctx.run.outputs.guide = { decision: { status: "ready" } };
	(
		ctx.run.outputs.capture as ReturnType<typeof qaExecution>
	).results[0].criteria[0].observed = "A replacement receipt";
	const postComment = vi.fn();
	const tools = new FactoryTools({
		postComment,
		command: async (_ctx, exe, args) => {
			if (exe === "git") return args[0] === "status" ? "" : "head";
			if (args.includes("graphql")) return JSON.stringify(providerReceipt());
			if (args[0] === "api") return "[[]]";
			return JSON.stringify({
				headRefOid: "head",
				isDraft: true,
				state: "OPEN",
			});
		},
	});
	await expect(tools.tool(ctx)).rejects.toThrow(
		"QA evidence changed or is incomplete",
	);
	expect(postComment).not.toHaveBeenCalled();
});

it("does not present legacy screenshot-only roles as QA when a runner supplies extra QA fields", () => {
	expect(validateFactoryResult("capture", qaExecution())).toEqual({
		screenshots: [],
		unavailable: [],
	});
	expect(
		validateFactoryResult("visual-review", {
			qaContract: "qa-v1",
			findings: [],
			summary: "Screenshot-only review",
			qaReviewStamp: {
				headSha: "invented",
				dirty: false,
				captureHash: "invented",
				scopeHash: "invented",
			},
		}),
	).toEqual({ findings: [], summary: "Screenshot-only review" });
});

it("uses a reported open criterion failure without generating a duplicate, but never accepts a rejection of failed behavior", async () => {
	const ctx = qaContext(),
		failed = qaExecution("failed");
	failed.findings = [
		{
			id: "save-failure",
			rating: 3,
			status: "open",
			summary: "Save lost the record",
			evidence: "Readback missing",
			storyId: "save",
			criterionId: "saved",
			requirementRefs: ["requirements/0"],
			reproduction: ["Save"],
			expected: "Record is persisted",
			actual: "Record missing",
		},
	];
	stampQa(ctx, failed);
	await expect(qaTools().tool(ctx)).resolves.toMatchObject({
		approved: false,
		findings: [expect.objectContaining({ id: "save-failure" })],
	});
	expect(
		((await qaTools().tool(ctx)) as { findings: unknown[] }).findings,
	).toHaveLength(1);
	failed.findings[0].status = "accepted-rejection";
	stampQa(ctx, failed);
	const rejected = (await qaTools().tool(ctx)) as {
		approved: boolean;
		findings: { id: string }[];
	};
	expect(rejected.approved).toBe(false);
	expect(rejected.findings).toHaveLength(1);
	expect(rejected.findings[0].id).not.toBe("save-failure");
});
