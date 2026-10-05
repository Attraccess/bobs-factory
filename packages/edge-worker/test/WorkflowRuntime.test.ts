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
	it("persists agent provenance before trimming an oversized event tail", () => {
		const { runtime, home } = create();
		const run = start(runtime, workflow([agent("review")]));
		const message = JSON.stringify({
			type: "user",
			content: "Tool output ".repeat(3000),
		});
		runtime.log(run, "review", message, "agent");
		runtime.log(run, "review", "Build output ".repeat(3000));
		const recovered = new WorkflowRuntime(home, {
			agent: async () => ({}),
			tool: async () => ({}),
			script: async () => ({}),
		}).get(run.id);
		expect(
			recovered.events.slice(-2).map((event) => ({
				source: event.source,
				length: event.message.length,
			})),
		).toEqual([
			{ source: "agent", length: 20000 },
			{ source: "workflow", length: 20000 },
		]);
	});
	it.each([
		false,
		true,
	])("retries only the failed step with preserved history (legacy=%s)", async (legacy) => {
		let fail = true;
		const execute = vi.fn(async (context: ExecutionContext) => {
			if (context.step.id === "publish" && fail)
				throw new Error("Commit hook rejected");
			return { summary: context.step.id };
		});
		const { runtime } = create({ agent: execute });
		const run = start(
			runtime,
			workflow([agent("implement"), agent("publish")]),
		);
		await runtime.launch(run);
		expect(run.status).toBe("failed");
		expect(run.error).toBe("Commit hook rejected");
		const history = structuredClone(run.history);
		if (legacy) delete run.checkpoint;
		fail = false;
		runtime.retry(run.id);
		expect(() => runtime.retry(run.id)).toThrow("Only failed");
		await vi.waitFor(() => expect(run.status).toBe("completed"));
		expect(run.error).toBeUndefined();
		expect(run.history.slice(0, history.length)).toEqual(history);
		expect(run.history.map((item) => item.step)).toEqual([
			"implement",
			"publish",
		]);
		expect(execute.mock.calls.map(([context]) => context.step.id)).toEqual([
			"implement",
			"publish",
			"publish",
		]);
		expect(() => runtime.retry(run.id)).toThrow("Only failed");
		run.status = "stopped";
		expect(() => runtime.retry(run.id)).toThrow("Only failed");
	});
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
		run.launchInputs = { target: "customer dashboard" };
		await runtime.launch(run);
		expect(inputs[1]).toEqual({
			step: "implement",
			input: { plan: { plan: "Build it", assets: [] } },
		});
		expect(inputs[2]).toMatchObject({
			input: {
				originalInput: "PRIVATE TICKET INPUT",
				launchInputs: { target: "customer dashboard" },
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
	it("retains active status and history until startup recovery is launched", () => {
		const { runtime, home } = create();
		const run = start(runtime, workflow([agent("work")]));
		runtime.log(run, "work", "working");
		const restarted = new WorkflowRuntime(home, {
			agent: async () => ({}),
			script: async () => ({}),
			tool: async () => ({}),
		});
		expect(restarted.get(run.id).status).toBe("running");
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

function reload(home: string, hooks: Partial<RuntimeHooks> = {}) {
	return new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
		...hooks,
	});
}
function untilAborted(context: ExecutionContext): Promise<unknown> {
	return new Promise((resolve) =>
		context.signal.addEventListener("abort", () => resolve({}), { once: true }),
	);
}
it.each([
	false,
	true,
])("recovers nested review loops without rerunning completed work or resetting limits (legacy=%s)", async (legacy) => {
	const first = vi.fn(async (context: ExecutionContext) => {
		if (context.step.id === "review") return { approved: false };
		context.checkpointAgent?.({
			runner: "codex",
			sessionId: "fix-conversation",
		});
		context.log(
			JSON.stringify({ type: "assistant", session_id: "fix-conversation" }),
		);
		return untilAborted(context);
	});
	const { runtime, home } = create({ agent: first });
	runtime.updateWorkflows(
		validateWorkflows([
			...defaultWorkflows,
			{
				id: "shared",
				name: "Shared",
				internal: true,
				steps: [
					agent("review", {
						maxVisits: 2,
						branches: [
							{ when: { path: "approved", equals: true }, next: "end" },
						],
					}),
					agent("fix", { maxVisits: 1, runner: "codex", next: "review" }),
				],
			},
			{
				id: "parent",
				name: "Parent",
				steps: [
					{
						id: "pipeline",
						name: "Pipeline",
						type: "workflow",
						workflow: "shared",
					},
				],
			},
		]),
	);
	const run = start(runtime, runtime.selectWorkflow([], "parent"));
	void runtime.launch(run);
	await vi.waitFor(() => expect(first).toHaveBeenCalledTimes(2));
	await runtime.shutdown();
	expect(run.status).toBe("running");
	expect(run.history.map((item) => item.step)).toEqual(["pipeline/review"]);
	if (legacy) {
		delete run.checkpoint;
		runtime.save(run);
	}
	const resumed = vi.fn(async (context: ExecutionContext) => {
		if (context.step.id === "fix") {
			expect(context.resumeAgent).toEqual({
				runner: "codex",
				sessionId: "fix-conversation",
			});
			expect(context.run.history.map((item) => item.step)).toEqual([
				"pipeline/review",
			]);
			return { fixed: true };
		}
		expect(context.resumeAgent).toBeUndefined();
		return { approved: true };
	});
	const restarted = reload(home, { agent: resumed });
	restarted.resumeAll();
	restarted.resumeAll(); // Repeated startup recovery cannot launch a duplicate executor.
	await vi.waitFor(() =>
		expect(restarted.get(run.id).status).toBe("completed"),
	);
	expect(resumed.mock.calls.map(([context]) => context.step.id)).toEqual([
		"fix",
		"review",
	]);
	expect(restarted.get(run.id).history.map((item) => item.step)).toEqual([
		"pipeline/review",
		"pipeline/fix",
		"pipeline/review",
		"pipeline",
	]);
	expect(restarted.get(run.id).checkpoint?.active).toBeUndefined();
});
it("recovers partial fanout with isolated outputs, skipping the finished branch", async () => {
	const { runtime, home } = create({
		agent: async (context) => {
			if (context.step.id === "fast") return { value: "retained" };
			context.checkpointAgent?.({
				runner: "claude",
				sessionId: "slow-conversation",
			});
			return untilAborted(context);
		},
	});
	const run = start(
		runtime,
		workflow([
			{
				id: "parallel",
				name: "Parallel",
				type: "fanout",
				groups: [[agent("fast")], [agent("slow")]],
			},
		]),
	);
	void runtime.launch(run);
	await vi.waitFor(() =>
		expect(run.history.map((item) => item.step)).toEqual(["parallel/0/fast"]),
	);
	await runtime.shutdown();
	const agentHook = vi.fn(async (context: ExecutionContext) => {
		expect(context.step.id).toBe("slow");
		expect(context.resumeAgent).toEqual({
			runner: "claude",
			sessionId: "slow-conversation",
		});
		expect(context.outputs).not.toHaveProperty("fast");
		return { value: "resumed" };
	});
	const restarted = reload(home, { agent: agentHook });
	restarted.resumeAll();
	await vi.waitFor(() =>
		expect(restarted.get(run.id).status).toBe("completed"),
	);
	expect(agentHook).toHaveBeenCalledTimes(1);
	expect(restarted.get(run.id).outputs.parallel).toEqual([
		{ fast: { value: "retained" } },
		{ slow: { value: "resumed" } },
	]);
});
it.each([
	false,
	true,
])("restores unanswered questions without reasking, and waits for a human (legacy=%s)", async (legacy) => {
	const question = vi.fn(async () => {});
	const { runtime, home } = create({
		agent: async () => ({ questions: ["Which provider?"] }),
		question,
	});
	const run = start(
		runtime,
		workflow([
			agent("clarify", { askQuestions: true, maxVisits: 2 }),
			agent("implement"),
		]),
	);
	void runtime.launch(run);
	await vi.waitFor(() => expect(question).toHaveBeenCalledTimes(1));
	await runtime.shutdown();
	expect(run.status).toBe("waiting");
	if (legacy) {
		delete run.checkpoint;
		runtime.save(run);
	}
	const agentHook = vi.fn(async (context: ExecutionContext) => {
		expect(context.run.answers[0]?.answer).toBe("Codex");
		return { questions: [] };
	});
	const restarted = reload(home, { agent: agentHook, question });
	restarted.resumeAll();
	await vi.waitFor(() =>
		expect(restarted.get(run.id).events.at(-1)?.message).toBe(
			"Which provider?",
		),
	);
	expect(restarted.get(run.id).status).toBe("waiting");
	expect(question).toHaveBeenCalledTimes(1);
	expect(agentHook).not.toHaveBeenCalled();
	restarted.answer(run.id, "Codex");
	await vi.waitFor(() =>
		expect(restarted.get(run.id).status).toBe("completed"),
	);
	expect(agentHook.mock.calls.map(([context]) => context.step.id)).toEqual([
		"clarify",
		"implement",
	]);
	expect(restarted.get(run.id).history).toHaveLength(3);
});
it("keeps an accepted answer across a crash before the clarifier continues", async () => {
	const { runtime, home } = create({
		agent: async () => ({ questions: ["Proceed?"] }),
	});
	const run = start(
		runtime,
		workflow([agent("clarify", { askQuestions: true, maxVisits: 2 })]),
	);
	void runtime.launch(run);
	await vi.waitFor(() => expect(run.status).toBe("waiting"));
	runtime.answer(run.id, "Yes");
	const snapshot = readFileSync(
		join(home, "factory", "runs", `${run.id}.json`),
		"utf8",
	);
	await runtime.shutdown();
	writeFileSync(join(home, "factory", "runs", `${run.id}.json`), snapshot);
	const agentHook = vi.fn(async (context: ExecutionContext) => {
		expect(context.run.answers).toHaveLength(1);
		return { questions: [] };
	});
	const restarted = reload(home, { agent: agentHook });
	restarted.resumeAll();
	await vi.waitFor(() =>
		expect(restarted.get(run.id).status).toBe("completed"),
	);
	expect(agentHook).toHaveBeenCalledTimes(1);
	expect(restarted.get(run.id).answers).toHaveLength(1);
});
it("does not resume completed, failed or explicitly stopped runs", async () => {
	const { runtime, home } = create({
		agent: async () => {
			throw new Error("failure");
		},
	});
	const failed = start(runtime, workflow([agent("work")]));
	await runtime.launch(failed);
	const stopped = start(runtime, workflow([agent("work")]));
	runtime.stop(stopped.id);
	const completed = start(runtime, workflow([agent("work")]));
	completed.status = "completed";
	runtime.save(completed);
	const agentHook = vi.fn(async () => ({}));
	const restarted = reload(home, { agent: agentHook });
	restarted.resumeAll();
	expect(agentHook).not.toHaveBeenCalled();
	expect([...restarted.runs.values()].map((run) => run.status)).toEqual(
		expect.arrayContaining(["failed", "stopped", "completed"]),
	);
});

it("restores an explicit human gate without approving, repeats rejected work, and binds approval to its SHA", async () => {
	const order: string[] = [];
	const hooks = {
		tool: async (context: ExecutionContext) => {
			order.push(context.step.id);
			return context.step.tool === "human-review"
				? {
						headSha: context.run.humanDecisions?.length ? "second" : "first",
						url: "https://github.com/test/repo/pull/1",
					}
				: { merged: true };
		},
		agent: async (context: ExecutionContext) => {
			order.push(context.step.id);
			expect(context.input).toMatchObject({
				humanDecisions: [{ decision: "reject", feedback: "Fix label" }],
			});
			return {};
		},
	};
	const { runtime, home } = create(hooks);
	const definition = workflow([
		{
			id: "human-review",
			name: "Review",
			type: "tool",
			tool: "human-review",
			branches: [
				{ when: { path: "decision", equals: "reject" }, next: "human-fix" },
			],
			next: "merge",
		},
		{
			id: "human-fix",
			name: "Fix",
			type: "agent",
			prompt: "Fix",
			next: "human-review",
		},
		{ id: "merge", name: "Merge", type: "tool", tool: "merge", next: "end" },
	]);
	const run = start(runtime, definition);
	const launched = runtime.launch(run);
	await vi.waitFor(() => expect(run.status).toBe("waiting"));
	const gate = structuredClone(run.reviewGate!);
	expect(() =>
		runtime.decide(run.id, {
			reviewId: gate.id,
			headSha: "wrong",
			decision: "approve",
		}),
	).toThrow("revision changed");
	expect(() =>
		runtime.decide(run.id, {
			reviewId: gate.id,
			headSha: gate.headSha,
			decision: "reject",
		}),
	).toThrow("Explain");
	await runtime.shutdown();
	await launched;
	const restarted = new WorkflowRuntime(home, {
		script: async () => ({}),
		...hooks,
	});
	restarted.resumeAll();
	const restored = restarted.get(run.id);
	await vi.waitFor(() => expect(restored.status).toBe("waiting"));
	expect(restored.reviewGate).toEqual(gate);
	expect(order).toEqual(["human-review"]);
	restarted.decide(run.id, {
		reviewId: gate.id,
		headSha: gate.headSha,
		decision: "reject",
		feedback: "Fix label",
	});
	await vi.waitFor(() => expect(restored.reviewGate?.headSha).toBe("second"));
	expect(restored.status).toBe("waiting");
	expect(() =>
		restarted.decide(run.id, {
			reviewId: gate.id,
			headSha: gate.headSha,
			decision: "approve",
		}),
	).toThrow("revision changed");
	restarted.decide(run.id, {
		reviewId: restored.reviewGate!.id,
		headSha: "second",
		decision: "approve",
	});
	await vi.waitFor(() => expect(restored.status).toBe("completed"));
	expect(restored.humanDecisions?.map((x) => x.decision)).toEqual([
		"reject",
		"approve",
	]);
	expect(order).toEqual(["human-review", "human-fix", "human-review", "merge"]);
	expect(
		new WorkflowRuntime(home, { script: async () => ({}), ...hooks }).get(
			run.id,
		).humanDecisions,
	).toEqual(restored.humanDecisions);
	expect(restarted.viewState(run.id).settledAt).toBeTruthy();
});
it("rejects human review gates hidden in shared fanout workflows", () => {
	expect(() =>
		validateWorkflows([
			...defaultWorkflows,
			{
				id: "gate",
				name: "Gate",
				steps: [
					{ id: "review", name: "Review", type: "tool", tool: "human-review" },
				],
			},
			{
				id: "parent",
				name: "Parent",
				steps: [
					{
						id: "parallel",
						name: "Parallel",
						type: "fanout",
						groups: [
							[
								{
									id: "child",
									name: "Child",
									type: "workflow",
									workflow: "gate",
								},
							],
						],
					},
				],
			},
		]),
	).toThrow("outside fanout");
});
