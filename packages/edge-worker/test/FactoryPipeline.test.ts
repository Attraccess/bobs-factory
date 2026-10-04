import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import {
	executeCommand,
	FactoryTools,
	filterReview,
} from "../src/factory/FactoryTools.js";
import {
	type ExecutionContext,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";

const directories: string[] = [];
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
				});
				return {};
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
			if (step === "ci") return { approved: ++ci > 1 };
			return {};
		},
	});
	const run = runtime.create({
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
			return args[1] === "view"
				? JSON.stringify({ headRefOid: "head", isDraft: true, state: "OPEN" })
				: JSON.stringify([{ bucket: "fail" }]);
		},
	});
	await expect(tools.tool(input)).rejects.toThrow("CI is no longer green");
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
