import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { validateFactoryResult } from "../src/factory/FactoryResults.js";
import {
	filterReview,
	parseAgentOutput,
	toolArguments,
} from "../src/factory/FactoryTools.js";
import { validateWorkflows, type Workflow } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	type RuntimeHooks,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";

const homes: string[] = [];
afterEach(() => {
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
function create(hooks: Partial<RuntimeHooks> = {}) {
	const home = mkdtempSync(join(tmpdir(), "factory-runtime-"));
	homes.push(home);
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
		...hooks,
	});
	return { runtime, home };
}
function workflow(steps: unknown[]): Workflow {
	return validateWorkflows([
		...defaultWorkflows,
		{ id: "custom", name: "Custom", steps },
	]).at(-1)!;
}
const agent = (id: string, extra = {}) => ({
	id,
	name: id,
	type: "agent",
	prompt: "Do the task",
	...extra,
});
function start(runtime: WorkflowRuntime, definition: Workflow) {
	return runtime.create({
		title: "Build a dashboard",
		repositoryId: "repo",
		workspace: "/tmp",
		input: "PRIVATE TICKET INPUT",
		workflow: definition,
	});
}

describe("workflow runtime", () => {
	it("uses the persisted default behind explicit choices and matching labels, including legacy config", () => {
		const { runtime, home } = create();
		expect(runtime.getDefaultWorkflow()).toBe("simple");
		expect(runtime.selectWorkflow([]).id).toBe("simple");
		writeFileSync(
			join(home, "factory", "workflows.json"),
			JSON.stringify(defaultWorkflows),
		);
		const hooks = {
			agent: async () => ({}),
			script: async () => ({}),
			tool: async () => ({}),
		};
		const legacy = new WorkflowRuntime(home, hooks);
		expect(legacy.selectWorkflow([]).id).toBe("simple");
		const custom = workflow([agent("work")]);
		legacy.updateWorkflows([...defaultWorkflows, custom], "custom");
		expect(legacy.selectWorkflow([]).id).toBe("custom");
		expect(legacy.selectWorkflow(["unrelated"]).id).toBe("custom");
		expect(legacy.selectWorkflow(["workflow:factory"]).id).toBe("factory");
		expect(legacy.selectWorkflow(["workflow:factory"], "simple").id).toBe(
			"simple",
		);
		expect(() => legacy.selectWorkflow([], "missing")).toThrow(
			"Unknown workflow",
		);
		const restarted = new WorkflowRuntime(home, hooks);
		expect(restarted.getDefaultWorkflow()).toBe("custom");
		expect(restarted.selectWorkflow([]).id).toBe("custom");
		// Legacy API callers updating definitions retain the selected default.
		restarted.updateWorkflows(restarted.listWorkflows());
		expect(restarted.getDefaultWorkflow()).toBe("custom");
	});
	it("rejects missing or deleted defaults without changing the saved configuration or existing runs", () => {
		const { runtime, home } = create();
		const custom = workflow([agent("work")]);
		runtime.updateWorkflows([...defaultWorkflows, custom], "custom");
		const run = start(runtime, runtime.selectWorkflow([]));
		const saved = readFileSync(join(home, "factory", "workflows.json"), "utf8");
		expect(() => runtime.updateWorkflows(defaultWorkflows, "missing")).toThrow(
			"Unknown default workflow",
		);
		expect(() => runtime.updateWorkflows(defaultWorkflows)).toThrow(
			"Unknown default workflow",
		);
		expect(readFileSync(join(home, "factory", "workflows.json"), "utf8")).toBe(
			saved,
		);
		expect(runtime.selectWorkflow([]).id).toBe("custom");
		runtime.updateWorkflows(defaultWorkflows, "factory");
		expect(runtime.selectWorkflow([]).id).toBe("factory");
		expect(run.workflow.id).toBe("custom");
	});
	it("waits for human answers and repeats clarification with retained Q&A", async () => {
		const execute = vi.fn(async (context: ExecutionContext) =>
			context.run.answers.length
				? { questions: [], decisions: ["human choice"] }
				: { questions: ["Which provider?"] },
		);
		const { runtime, home } = create({ agent: execute });
		const run = start(
			runtime,
			workflow([agent("clarify", { askQuestions: true })]),
		);
		const promise = runtime.launch(run);
		await vi.waitFor(() => expect(run.status).toBe("waiting"));
		expect(execute).toHaveBeenCalledTimes(1);
		expect(
			JSON.parse(
				readFileSync(join(home, "factory", "runs", `${run.id}.json`), "utf8"),
			).questions,
		).toEqual(["Which provider?"]);
		runtime.answer(run.id, "Use Codex");
		await promise;
		expect(run.status).toBe("completed");
		expect(run.answers[0]).toMatchObject({
			questions: ["Which provider?"],
			answer: "Use Codex",
		});
		expect(run.history).toHaveLength(2);
	});
	it("terminates a waiting run and never starts downstream work", async () => {
		const execute = vi.fn(async () => ({ questions: ["Question"] }));
		const { runtime } = create({ agent: execute });
		const run = start(
			runtime,
			workflow([agent("clarify", { askQuestions: true }), agent("implement")]),
		);
		const promise = runtime.launch(run);
		await vi.waitFor(() => expect(run.status).toBe("waiting"));
		runtime.stop(run.id);
		await promise;
		expect(run.status).toBe("stopped");
		expect(execute).toHaveBeenCalledTimes(1);
		expect(() => runtime.answer(run.id, "late answer")).toThrow("not waiting");
	});
	it("passes only the plan to implementer while retaining review/fixer history", async () => {
		const inputs: Record<string, unknown>[] = [];
		const { runtime } = create({
			agent: async (context) => {
				inputs.push({
					step: context.step.id,
					input: structuredClone(context.input),
				});
				return context.step.id === "plan"
					? { plan: "Build it", assets: [] }
					: { summary: "done" };
			},
		});
		const run = start(
			runtime,
			workflow([
				agent("plan"),
				agent("implement", { inputs: ["plan"] }),
				agent("review"),
			]),
		);
		await runtime.launch(run);
		expect(inputs[1]).toEqual({
			step: "implement",
			input: { plan: { plan: "Build it", assets: [] } },
		});
		expect(inputs[2]).toMatchObject({
			input: {
				originalInput: "PRIVATE TICKET INPUT",
				history: [{ step: "plan" }, { step: "implement" }],
			},
		});
	});
	it("executes conditional loops and stops visibly at the iteration cap", async () => {
		const { runtime } = create({ agent: async () => ({ approved: false }) });
		const run = start(
			runtime,
			workflow([
				agent("review", {
					maxVisits: 2,
					branches: [
						{ when: { path: "approved", equals: false }, next: "review" },
					],
				}),
			]),
		);
		await runtime.launch(run);
		expect(run.status).toBe("failed");
		expect(run.history).toHaveLength(2);
		expect(run.error).toMatch(/Iteration limit/);
	});
	it("fans out concurrently and joins isolated branch outputs", async () => {
		let arrived = 0;
		let release!: () => void;
		const barrier = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { runtime } = create({
			agent: async (context) => {
				arrived++;
				if (arrived === 2) release();
				await barrier;
				return { role: context.step.id };
			},
		});
		const run = start(
			runtime,
			workflow([
				{
					id: "parallel",
					name: "Parallel",
					type: "fanout",
					groups: [[agent("first")], [agent("second")]],
				},
			]),
		);
		await runtime.launch(run);
		expect(run.status).toBe("completed");
		expect(run.outputs.parallel).toEqual([
			{ first: { role: "first" } },
			{ second: { role: "second" } },
		]);
	});
	it("cancels sibling fanout work when a branch fails", async () => {
		let siblingStopped = false;
		const { runtime } = create({
			agent: async (context) => {
				if (context.step.id === "fail") throw new Error("branch failed");
				return new Promise((resolve) =>
					context.signal.addEventListener("abort", () => {
						siblingStopped = true;
						resolve({});
					}),
				);
			},
		});
		const run = start(
			runtime,
			workflow([
				{
					id: "parallel",
					name: "Parallel",
					type: "fanout",
					groups: [[agent("fail")], [agent("other")]],
				},
			]),
		);
		await runtime.launch(run);
		expect(run.status).toBe("failed");
		expect(siblingStopped).toBe(true);
	});
	it("retains history across restart without falsely resuming a run", () => {
		const { runtime, home } = create();
		const run = start(runtime, workflow([agent("work")]));
		runtime.log(run, "work", "working");
		const restarted = new WorkflowRuntime(home, {
			agent: async () => ({}),
			script: async () => ({}),
			tool: async () => ({}),
		});
		expect(restarted.get(run.id).status).toBe("interrupted");
		expect(restarted.get(run.id).events[0]?.message).toBe("working");
	});
	it("freezes the workflow per run and applies saved changes only to new runs", () => {
		const { runtime } = create();
		const run = start(runtime, runtime.selectWorkflow(["workflow:factory"]));
		const definitions = runtime.listWorkflows();
		definitions.find((item) => item.id === "factory")!.name = "New name";
		runtime.updateWorkflows(definitions);
		expect(run.workflow.name).toBe("Software factory");
		expect(runtime.selectWorkflow([], "factory").name).toBe("New name");
	});
	it("rejects dangling edges, duplicate IDs and malformed results", () => {
		expect(() => workflow([agent("x", { next: "missing" })])).toThrow(
			"Unknown step",
		);
		expect(() => workflow([agent("x"), agent("x")])).toThrow("Duplicate");
		expect(() => validateFactoryResult("plan-review", {})).toThrow();
		expect(() =>
			validateFactoryResult("visual-scope", { changed: true, areas: [] }),
		).toThrow();
		expect(() => parseAgentOutput("done")).toThrow("JSON");
	});
	it("discards nitpicks and keeps meaningful findings and accepted rejections", () => {
		const result = filterReview({
			summary: "Review",
			findings: [1, 2, 3].map((rating) => ({
				id: String(rating),
				rating,
				summary: "Issue",
				evidence: "file:1",
			})),
		});
		expect(result.findings.map((finding) => finding.rating)).toEqual([2, 3]);
	});
	it("resolves MCP inputs without losing object types and rejects missing references", () => {
		const { runtime } = create();
		const run = start(runtime, workflow([agent("work")]));
		run.outputs.plan = { plan: "Plan", assets: [] };
		const context: ExecutionContext = {
			run,
			step: run.workflow.steps[0]!,
			input: {},
			signal: new AbortController().signal,
			log: () => {},
			evidenceDir: "/tmp/evidence",
		};
		expect(
			toolArguments(context, {
				object: "{{outputs.plan}}",
				path: "{{evidenceDir}}/image.png",
			}),
		).toEqual({
			object: { plan: "Plan", assets: [] },
			path: "/tmp/evidence/image.png",
		});
		expect(() => toolArguments(context, "{{outputs.missing}}")).toThrow(
			"Missing tool input",
		);
	});
});

it("calls frozen reusable workflows with shared plan/history and human checkpoints", async () => {
	const { runtime, home } = create({
		agent: async (context) => {
			if (context.step.id === "clarify")
				return {
					questions: context.run.answers.length
						? []
						: ["Continue existing work?"],
				};
			if (context.step.id === "plan")
				return { plan: "Continue the existing branch", assets: [] };
			if (context.step.id === "implement") {
				expect(context.input).toEqual({
					plan: { plan: "Continue the existing branch", assets: [] },
				});
				return { summary: "done" };
			}
			return {};
		},
	});
	const shared = {
		id: "shared",
		name: "Shared",
		internal: true,
		steps: [
			agent("clarify", { askQuestions: true }),
			agent("plan"),
			agent("implement", { inputs: ["plan"] }),
		],
	};
	const definitions = validateWorkflows([
		...defaultWorkflows,
		shared,
		{
			id: "parent",
			name: "Parent",
			steps: [
				{ id: "call", name: "Call", type: "workflow", workflow: "shared" },
			],
		},
	]);
	runtime.updateWorkflows(definitions);
	const run = start(runtime, runtime.selectWorkflow([], "parent"));
	const execution = runtime.launch(run);
	await vi.waitFor(() => expect(run.status).toBe("waiting"));
	const changed = runtime.listWorkflows();
	changed.find((item) => item.id === "shared")!.steps = [];
	// Saved configuration cannot alter the definition captured by an active run.
	changed.find((item) => item.id === "shared")!.steps = [agent("replacement")];
	runtime.updateWorkflows(changed);
	runtime.answer(run.id, "Yes");
	await execution;
	expect(run.status).toBe("completed");
	expect(run.history.map((item) => item.step)).toEqual([
		"call/clarify",
		"call/clarify",
		"call/plan",
		"call/implement",
		"call",
	]);
	expect(run.outputs.call).toEqual({ workflow: "shared", completed: true });
	expect(
		JSON.parse(
			readFileSync(join(home, "factory", "runs", `${run.id}.json`), "utf8"),
		).workflowDefinitions.find((item: Workflow) => item.id === "shared")
			.steps[0].id,
	).toBe("clarify");
});
it("rejects missing/recursive workflow calls and hidden human checkpoints in fanout", () => {
	const call = (target: string) => ({
		id: "call",
		name: "Call",
		type: "workflow",
		workflow: target,
	});
	expect(() => workflow([call("missing")])).toThrow(
		"Unknown or uncallable workflow",
	);
	expect(() => workflow([call("custom")])).toThrow("Recursive workflow");
	expect(() =>
		validateWorkflows([
			...defaultWorkflows,
			{ id: "a", name: "A", steps: [call("b")] },
			{ id: "b", name: "B", steps: [call("a")] },
		]),
	).toThrow("Recursive workflow");
	expect(() =>
		workflow([
			{
				id: "parallel",
				name: "Parallel",
				type: "fanout",
				groups: [[call("factory-pipeline")]],
			},
		]),
	).toThrow("Human checkpoints");
});
it("upgrades a saved flat Factory without losing role settings or its selected default", () => {
	const { runtime, home } = create();
	const shared = structuredClone(
		defaultWorkflows.find((item) => item.id === "factory-pipeline")!,
	);
	shared.steps[0]!.model = "custom-model";
	const oldFactory = { ...defaultWorkflows[1]!, steps: shared.steps };
	writeFileSync(
		join(home, "factory", "workflows.json"),
		JSON.stringify({
			workflows: [defaultWorkflows[0], oldFactory],
			defaultWorkflow: "factory",
		}),
	);
	const restarted = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	expect(restarted.selectWorkflow([]).id).toBe("factory");
	expect(
		restarted.listWorkflows().find((item) => item.id === "factory-pipeline")!
			.steps[0]!.model,
	).toBe("custom-model");
	expect(restarted.selectWorkflow(["workflow:takeover"]).id).toBe("takeover");
	expect(() => restarted.selectWorkflow([], "factory-pipeline")).toThrow(
		"Unknown workflow",
	);
	expect(runtime.getDefaultWorkflow()).toBe("simple");
});
