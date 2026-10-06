import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	defaultWorkflows,
	upgradeWorkflows,
} from "../src/factory/defaultWorkflows.js";
import { validateFactoryResult } from "../src/factory/FactoryResults.js";
import {
	filterReview,
	parseAgentOutput,
	toolArguments,
} from "../src/factory/FactoryTools.js";
import { legacyScreenshotSteps } from "../src/factory/legacyScreenshotSteps.js";
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
function workflow(steps: unknown[], dependencies: unknown[] = []): Workflow {
	return validateWorkflows([
		...defaultWorkflows,
		...dependencies,
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
		triggerOrigin: {
			type: "manual",
			workflowId: definition.id,
			at: new Date().toISOString(),
		},
		title: "Build a dashboard",
		repositoryId: "repo",
		workspace: "/tmp",
		input: "PRIVATE TICKET INPUT",
		workflow: definition,
	});
}

describe("workflow trigger permissions", () => {
	it.each([
		false,
		true,
	])("normalizes legacy configuration idempotently, preserving custom roles/default (object=%s)", (object) => {
		const { home, runtime } = create();
		const legacy = [
			...defaultWorkflows,
			workflow([agent("work", { model: "custom-model" })]),
		].map(({ allowedTriggers: _triggers, ...definition }) => definition);
		writeFileSync(
			join(home, "factory", "workflows.json"),
			JSON.stringify(
				object ? { workflows: legacy, defaultWorkflow: "custom" } : legacy,
			),
		);
		const migrated = reload(home);
		expect(migrated.getDefaultWorkflow()).toBe(object ? "custom" : "simple");
		expect(
			migrated.listWorkflows().map((w) => [w.id, w.allowedTriggers]),
		).toEqual([
			["simple", ["manual", "ticket-assignment"]],
			["factory", ["workflow", "manual", "ticket-assignment"]],
			["takeover", ["workflow", "manual", "ticket-assignment"]],
			["factory-pipeline", ["workflow"]],
			["custom", ["workflow", "manual", "ticket-assignment"]],
		]);
		expect(migrated.listWorkflows().at(-1)!.steps[0]!.model).toBe(
			"custom-model",
		);
		const saved = readFileSync(join(home, "factory", "workflows.json"), "utf8");
		reload(home);
		expect(readFileSync(join(home, "factory", "workflows.json"), "utf8")).toBe(
			saved,
		);
		expect(runtime.getDefaultWorkflow()).toBe("simple");
	});
	it("rejects selected disallowed explicit, first label and default without falling back", () => {
		const { runtime, home } = create();
		const first = {
			...workflow([agent("work")]),
			allowedTriggers: [],
			labels: ["first"],
		};
		const second = {
			...first,
			id: "second",
			name: "Second",
			labels: ["second"],
			allowedTriggers: ["ticket-assignment"],
		};
		runtime.updateWorkflows([...defaultWorkflows, first, second], "custom");
		for (const [labels, explicit] of [
			[[], "custom"],
			[["second", "first"], undefined],
			[[], undefined],
		] as const)
			expect(() =>
				runtime.selectWorkflow([...labels], "ticket-assignment", explicit),
			).toThrow(/custom.*ticket-assignment.*Recipes/);
		expect(
			runtime.selectLaunch(["second"], "ticket-assignment").selectionMethod,
		).toBe("label");
		expect(
			runtime.selectWorkflow(["first"], "ticket-assignment", "second").id,
		).toBe("second");
		expect(() => runtime.selectWorkflow([], "manual", "unknown")).toThrow(
			"Unknown workflow",
		);
		expect(runtime.getDefaultWorkflow()).toBe("custom");
		expect(
			reload(home)
				.listWorkflows()
				.find((w) => w.id === "custom")!.allowedTriggers,
		).toEqual([]);
	});
	it("permits deliberate top-level access to an internal recipe and an ineligible saved default", () => {
		const { runtime } = create();
		const saved = runtime.listWorkflows();
		const shared = saved.find((w) => w.internal)!;
		shared.allowedTriggers.push("manual");
		runtime.updateWorkflows(saved, shared.id);
		expect(runtime.selectWorkflow([], "manual").id).toBe(shared.id);
		expect(() => runtime.selectWorkflow([], "ticket-assignment")).toThrow(
			"ticket-assignment",
		);
	});
	it.each(
		[["manual", "manual"], ["unknown"], ["workflow"]].map(
			(allowedTriggers) => ({ allowedTriggers }),
		),
	)("rejects invalid Simple permissions $allowedTriggers without partial save", ({
		allowedTriggers,
	}) => {
		const { runtime, home } = create();
		const saved = runtime.listWorkflows();
		const disk = readFileSync(join(home, "factory", "workflows.json"), "utf8");
		expect(() =>
			runtime.updateWorkflows(
				saved.map((w) => (w.id === "simple" ? { ...w, allowedTriggers } : w)),
			),
		).toThrow();
		expect(runtime.listWorkflows()).toEqual(saved);
		expect(readFileSync(join(home, "factory", "workflows.json"), "utf8")).toBe(
			disk,
		);
	});
	it("rejects disabling a called child, including fanout, while preserving config", () => {
		const { runtime } = create();
		const child = {
			...workflow([agent("work")]),
			id: "child",
			internal: true,
			allowedTriggers: ["workflow"],
		};
		const parent = workflow(
			[
				{
					id: "fork",
					name: "Fork",
					type: "fanout",
					groups: [
						[{ id: "call", name: "Call", type: "workflow", workflow: "child" }],
					],
				},
			],
			[child],
		);
		runtime.updateWorkflows([...defaultWorkflows, parent, child]);
		const saved = runtime.listWorkflows();
		expect(() =>
			runtime.updateWorkflows(
				saved.map((w) =>
					w.id === "child" ? { ...w, allowedTriggers: [] } : w,
				),
			),
		).toThrow(/child.*workflow.*Recipes/);
		expect(runtime.listWorkflows()).toEqual(saved);
	});
	it.each([
		"manual",
		"ticket-assignment",
	] as const)("requires trusted root context and checks %s before saving a run", (type) => {
		const { runtime } = create();
		const definition = { ...workflow([agent("work")]), allowedTriggers: [] };
		expect(() =>
			runtime.create({
				title: "Denied",
				repositoryId: "repo",
				workspace: "/tmp",
				input: "",
				workflow: definition,
				triggerOrigin: {
					type,
					workflowId: definition.id,
					at: new Date().toISOString(),
				},
			}),
		).toThrow(`does not allow ${type}`);
		expect(runtime.runs.size).toBe(0);
	});
	it("uses frozen call permissions after edits/restart, retaining origin and one call-start receipt", async () => {
		const { runtime, home } = create({
			agent: async () => ({ questions: ["Choose?"] }),
		});
		const child = {
			...workflow([agent("ask", { askQuestions: true })]),
			id: "child",
			internal: true,
			allowedTriggers: ["workflow"],
		};
		const parent = workflow(
			[{ id: "call", name: "Call", type: "workflow", workflow: "child" }],
			[child],
		);
		runtime.updateWorkflows([...defaultWorkflows, parent, child]);
		const run = start(runtime, runtime.selectWorkflow([], "manual", "custom"));
		void runtime.launch(run);
		await vi.waitFor(() => expect(run.status).toBe("waiting"));
		const call = {
			type: "workflow",
			callerWorkflowId: "custom",
			step: "call",
			key: "call",
			workflowId: "child",
		};
		expect(run.events.filter((e) => e.call).map((e) => e.call)).toEqual([call]);
		runtime.updateWorkflows(defaultWorkflows);
		await runtime.shutdown();
		const restarted = reload(home, {
			agent: async (ctx) => ({
				questions: ctx.run.answers.length ? [] : ["Choose?"],
			}),
		});
		const restored = restarted.get(run.id);
		expect(restored.triggerOrigin).toEqual(run.triggerOrigin);
		void restarted.launch(restored);
		await vi.waitFor(() => expect(restored.status).toBe("waiting"));
		restarted.answer(restored.id, "Yes");
		await vi.waitFor(() => expect(restored.status).toBe("completed"));
		expect(restored.events.filter((e) => e.call).map((e) => e.call)).toEqual([
			call,
		]);
		expect(restored.history.find((h) => h.step === "call")?.call).toEqual(call);
		expect(restored.workflowCalls).toEqual(run.workflowCalls);
		expect(restored.workflowCalls).toHaveLength(1);
	});
	it("defends nested execution against a corrupt frozen target", async () => {
		const script = vi.fn();
		const { runtime } = create({ script });
		const child = {
			...workflow([
				{ id: "work", name: "Work", type: "script", script: "echo ok" },
			]),
			id: "child",
		};
		const parent = workflow(
			[{ id: "call", name: "Call", type: "workflow", workflow: "child" }],
			[child],
		);
		runtime.updateWorkflows([...defaultWorkflows, parent, child]);
		const run = start(runtime, parent);
		run.workflowDefinitions!.find((w) => w.id === "child")!.allowedTriggers =
			[];
		await runtime.launch(run);
		expect(run.status).toBe("failed");
		expect(run.error).toMatch(/child.*workflow.*Recipes/);
		expect(script).not.toHaveBeenCalled();
	});
});

describe("workflow runtime", () => {
	it("batches agent event bursts while saving checkpoints immediately", async () => {
		vi.useFakeTimers();
		try {
			const { runtime, home } = create();
			const run = start(runtime, workflow([agent("review")]));
			const changed = vi.fn();
			runtime.subscribe(changed);
			const path = join(home, "factory", "runs", `${run.id}.json`);
			for (let index = 0; index < 500; index++)
				runtime.log(run, "review", `Tool result ${index}`, "agent");
			expect(run.events).toHaveLength(500);
			expect(changed).not.toHaveBeenCalled();
			expect(JSON.parse(readFileSync(path, "utf8")).events).toEqual([]);
			await vi.advanceTimersByTimeAsync(250);
			expect(changed).toHaveBeenCalledTimes(1);
			expect(JSON.parse(readFileSync(path, "utf8")).events).toEqual(run.events);

			runtime.log(run, "review", "Last tool result", "agent");
			run.checkpoint = { current: "end", visits: { review: 1 } };
			runtime.save(run);
			const saved = JSON.parse(readFileSync(path, "utf8"));
			expect(saved.checkpoint).toEqual(run.checkpoint);
			expect(saved.events).toEqual(run.events);
			await vi.advanceTimersByTimeAsync(250);
			expect(changed).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});
	it("flushes pending agent activity on shutdown", async () => {
		vi.useFakeTimers();
		try {
			const { runtime, home } = create();
			const run = start(runtime, workflow([agent("review")]));
			runtime.log(run, "review", "Final activity", "agent");
			await runtime.shutdown();
			expect(
				JSON.parse(
					readFileSync(join(home, "factory", "runs", `${run.id}.json`), "utf8"),
				).events,
			).toEqual(run.events);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it("upgrades the legacy visual reviewer with a real newline while retaining its model", () => {
		const saved = structuredClone(defaultWorkflows);
		const shared = saved.find(
			(definition) => definition.id === "factory-pipeline",
		)!;
		const reviewer = shared.steps.find((step) => step.id === "visual-review")!;
		reviewer.prompt = `${shared.steps.find((step) => step.id === "code-review")!.prompt}\nThis is a VISUAL review: open and inspect the actual screenshots, checking each requested area/state against the plan. Include areas with missing/unavailable capture evidence as rating 3 findings. Never approve missing screenshots.`;
		reviewer.model = "custom-review-model";
		const upgraded = validateWorkflows(upgradeWorkflows(saved))
			.find((definition) => definition.id === "factory-pipeline")!
			.steps.find((step) => step.id === "visual-review")!;
		expect(upgraded.prompt).toBe(
			defaultWorkflows
				.find((definition) => definition.id === "factory-pipeline")!
				.steps.find((step) => step.id === "visual-review")!.prompt,
		);
		expect(upgraded.model).toBe("custom-review-model");
		reviewer.prompt = "My custom visual review instructions";
		expect(
			validateWorkflows(upgradeWorkflows(saved))
				.find((definition) => definition.id === "factory-pipeline")!
				.steps.find((step) => step.id === "visual-review")!.prompt,
		).toBe(reviewer.prompt);
	});
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
		expect(runtime.selectWorkflow([], "manual").id).toBe("simple");
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
		expect(legacy.selectWorkflow([], "manual").id).toBe("simple");
		const custom = workflow([agent("work")]);
		legacy.updateWorkflows([...defaultWorkflows, custom], "custom");
		expect(legacy.selectWorkflow([], "manual").id).toBe("custom");
		expect(legacy.selectWorkflow(["unrelated"], "manual").id).toBe("custom");
		expect(legacy.selectWorkflow(["workflow:factory"], "manual").id).toBe(
			"factory",
		);
		expect(
			legacy.selectWorkflow(["workflow:factory"], "manual", "simple").id,
		).toBe("simple");
		expect(() => legacy.selectWorkflow([], "manual", "missing")).toThrow(
			"Unknown workflow",
		);
		const restarted = new WorkflowRuntime(home, hooks);
		expect(restarted.getDefaultWorkflow()).toBe("custom");
		expect(restarted.selectWorkflow([], "manual").id).toBe("custom");
		// Legacy API callers updating definitions retain the selected default.
		restarted.updateWorkflows(restarted.listWorkflows());
		expect(restarted.getDefaultWorkflow()).toBe("custom");
	});
	it("rejects missing or deleted defaults without changing the saved configuration or existing runs", () => {
		const { runtime, home } = create();
		const custom = workflow([agent("work")]);
		runtime.updateWorkflows([...defaultWorkflows, custom], "custom");
		const run = start(runtime, runtime.selectWorkflow([], "manual"));
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
		expect(runtime.selectWorkflow([], "manual").id).toBe("custom");
		runtime.updateWorkflows(defaultWorkflows, "factory");
		expect(runtime.selectWorkflow([], "manual").id).toBe("factory");
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
		const run = start(
			runtime,
			runtime.selectWorkflow(["workflow:factory"], "manual"),
		);
		const definitions = runtime.listWorkflows();
		definitions.find((item) => item.id === "factory")!.name = "New name";
		runtime.updateWorkflows(definitions);
		expect(run.workflow.name).toBe("Software factory");
		expect(runtime.selectWorkflow([], "manual", "factory").name).toBe(
			"New name",
		);
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
	const run = start(runtime, runtime.selectWorkflow([], "manual", "parent"));
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
	expect(restarted.selectWorkflow([], "manual").id).toBe("factory");
	expect(
		restarted.listWorkflows().find((item) => item.id === "factory-pipeline")!
			.steps[0]!.model,
	).toBe("custom-model");
	expect(restarted.selectWorkflow(["workflow:takeover"], "manual").id).toBe(
		"takeover",
	);
	expect(() =>
		restarted.selectWorkflow([], "manual", "factory-pipeline"),
	).toThrow("does not allow manual");
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
	const run = start(runtime, runtime.selectWorkflow([], "manual", "parent"));
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

it("fails a capture-assistance checkpoint inside a frozen nested fanout without waiting", async () => {
	const question = vi.fn();
	const { runtime } = create({
		question,
		tool: async () => ({
			captureBlocked: true,
			approved: false,
			questions: ["Supply capture access"],
		}),
	});
	const captureFlow = {
		id: "capture-flow",
		name: "Capture flow",
		steps: [
			agent("capture"),
			agent("visual-review"),
			{ id: "gate", name: "Gate", type: "tool", tool: "visual-gate" },
		],
	};
	const run = start(
		runtime,
		workflow(
			[
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
								workflow: "capture-flow",
							},
						],
					],
				},
			],
			[captureFlow],
		),
	);
	run.workflowDefinitions!.push(
		validateWorkflows([...defaultWorkflows, captureFlow]).at(-1)!,
	);
	await runtime.launch(run);
	expect(run.status).toBe("failed");
	expect(run.error).toBe("Human checkpoints belong outside fanout branches");
	expect(question).not.toHaveBeenCalled();
});

it("grants a bounded persisted retry budget only to the exhausted nested step", async () => {
	let approve = false;
	const hooks = {
		agent: async () => ({ approved: approve }),
		script: async () => ({}),
		tool: async () => ({}),
	};
	const { runtime, home } = create(hooks);
	const child = workflow([
		agent("review", {
			maxVisits: 1,
			branches: [{ when: { path: "approved", equals: false }, next: "review" }],
		}),
	]);
	child.id = "child";
	runtime.updateWorkflows([...defaultWorkflows, child]);
	const parent = validateWorkflows([
		...defaultWorkflows,
		child,
		{
			id: "parent",
			name: "parent",
			steps: [
				{
					id: "pipeline",
					name: "pipeline",
					type: "workflow",
					workflow: "child",
				},
			],
		},
	]).at(-1)!;
	const run = start(runtime, parent);
	await runtime.launch(run);
	expect(run.iterationLimit).toEqual({
		step: "pipeline/review",
		visits: 2,
		limit: 1,
	});
	const prior = structuredClone(run.history);
	runtime.retry(run.id);
	await vi.waitFor(() => expect(run.status).toBe("failed"));
	expect(run.history).toHaveLength(5);
	expect(run.iterationLimit).toEqual({
		step: "pipeline/review",
		visits: 6,
		limit: 5,
	});
	expect(run.checkpoint?.additionalVisits).toBeUndefined();
	expect(run.checkpoint?.active?.children?.[0]?.additionalVisits).toEqual({
		review: 4,
	});
	const restarted = new WorkflowRuntime(home, hooks);
	const restored = restarted.get(run.id);
	expect(restored.history.slice(0, prior.length)).toEqual(prior);
	approve = true;
	restarted.retry(restored.id);
	await vi.waitFor(() => expect(restored.status).toBe("completed"));
	expect(
		restored.history.filter((x) => x.step === "pipeline/review"),
	).toHaveLength(6);
	expect(restored.iterationLimit).toBeUndefined();
});

it("upgrades only stock CI routing, retaining customized models and routes", () => {
	const definitions = structuredClone(defaultWorkflows);
	const shared = definitions.find((x) => x.id === "factory-pipeline")!;
	shared.steps = shared.steps.filter((x) => x.id !== "after-ci-fix");
	const fix = shared.steps.find((x) => x.id === "ci-fix")!;
	fix.next = "code-review";
	fix.model = "custom-fixer";
	const upgraded = validateWorkflows(upgradeWorkflows(definitions)).find(
		(x) => x.id === "factory-pipeline",
	)!;
	expect(upgraded.steps.find((x) => x.id === "ci-fix")).toMatchObject({
		next: "after-ci-fix",
		model: "custom-fixer",
	});
	expect(
		validateWorkflows(upgradeWorkflows(upgradeWorkflows(definitions)))
			.find((x) => x.id === "factory-pipeline")!
			.steps.filter((x) => x.id === "after-ci-fix"),
	).toHaveLength(1);
	fix.prompt = "Custom CI correction policy";
	expect(
		validateWorkflows(upgradeWorkflows(definitions))
			.find((x) => x.id === "factory-pipeline")!
			.steps.find((x) => x.id === "ci-fix")!.next,
	).toBe("code-review");
});

it("upgrades handoff into the existing CI fix route without replacing custom routes", () => {
	const definitions = structuredClone(defaultWorkflows);
	const shared = definitions.find((x) => x.id === "factory-pipeline")!;
	const handoff = shared.steps.find((x) => x.id === "handoff")!;
	handoff.branches = [];
	const upgraded = validateWorkflows(upgradeWorkflows(definitions));
	expect(
		upgraded
			.find((x) => x.id === "factory-pipeline")!
			.steps.find((x) => x.id === "handoff")!.branches,
	).toEqual([{ when: { path: "fix", equals: true }, next: "ci-fix" }]);
	expect(upgradeWorkflows(upgraded)).toEqual(upgraded);
	handoff.branches = [
		{ when: { path: "fix", equals: true }, next: "code-review" },
	];
	expect(
		validateWorkflows(upgradeWorkflows(definitions))
			.find((x) => x.id === "factory-pipeline")!
			.steps.find((x) => x.id === "handoff")!.branches,
	).toEqual(handoff.branches);
	handoff.branches = [];
	shared.steps.find((x) => x.id === "ci")!.branches = [];
	expect(
		validateWorkflows(upgradeWorkflows(definitions))
			.find((x) => x.id === "factory-pipeline")!
			.steps.find((x) => x.id === "handoff")!.branches,
	).toEqual([]);
});

it("recovers a saved nested handoff through its existing fixer without replaying completed work", async () => {
	const called: string[] = [];
	const { runtime, home } = create({
		tool: async (ctx) => {
			called.push(ctx.step.id);
			if (ctx.step.id === "handoff") return { fix: true };
			throw new Error("Fixture stops after dispatching the fixer");
		},
		agent: async (ctx) => {
			called.push(ctx.step.id);
			return { summary: "Conflict resolved", checks: ["Fixture validation"] };
		},
	});
	const run = runtime.create({
		workflow: defaultWorkflows.find((x) => x.id === "factory")!,
		repositoryId: "repo",
		workspace: home,
		input: "Fixture",
		triggerOrigin: {
			type: "manual",
			workflowId: "factory",
			at: new Date().toISOString(),
		},
	});
	run
		.workflowDefinitions!.find((x) => x.id === "factory-pipeline")!
		.steps.find((x) => x.id === "handoff")!.branches = [];
	run.status = "failed";
	run.step = "pipeline/handoff";
	run.history = [
		{
			step: "pipeline/guide",
			output: { summary: "Accepted guide" },
			at: new Date().toISOString(),
		},
	];
	const history = structuredClone(run.history);
	run.checkpoint = {
		current: "pipeline",
		visits: { pipeline: 1 },
		active: {
			phase: "executing",
			children: [
				{
					current: "handoff",
					visits: { handoff: 1 },
					active: { phase: "executing" },
				},
			],
		},
	};
	runtime.save(run);
	runtime.retry(run.id);
	await vi.waitFor(() => expect(run.status).toBe("failed"));
	expect(called).toEqual(["handoff", "ci-fix", "after-ci-fix"]);
	expect(run.history[0]).toEqual(history[0]);
	expect(run.history.slice(1).map((x) => x.step)).toEqual([
		"pipeline/handoff",
		"pipeline/ci-fix",
	]);
	expect(run.step).toBe("pipeline/after-ci-fix");
});

it("upgrades stock coordination limits without changing agent/custom limits", () => {
	const definitions = structuredClone(defaultWorkflows);
	const shared = definitions.find((x) => x.id === "factory-pipeline")!;
	const gate = shared.steps.find((x) => x.id === "review-gate")!;
	gate.maxVisits = 8;
	const ci = shared.steps.find((x) => x.id === "ci")!;
	ci.maxVisits = 3;
	const upgraded = validateWorkflows(upgradeWorkflows(definitions)).find(
		(x) => x.id === "factory-pipeline",
	)!;
	expect(upgraded.steps.find((x) => x.id === "review-gate")!.maxVisits).toBe(
		100,
	);
	expect(upgraded.steps.find((x) => x.id === "ci")!.maxVisits).toBe(3);
	expect(upgraded.steps.find((x) => x.id === "code-review")!.maxVisits).toBe(8);
	ci.maxVisits = 8;
	ci.name = "Watch pull request CI";
	expect(
		validateWorkflows(upgradeWorkflows(definitions))
			.find((x) => x.id === "factory-pipeline")!
			.steps.find((x) => x.id === "ci")!.maxVisits,
	).toBe(100);
	gate.name = "My custom review gate";
	expect(
		validateWorkflows(upgradeWorkflows(definitions))
			.find((x) => x.id === "factory-pipeline")!
			.steps.find((x) => x.id === "review-gate")!.maxVisits,
	).toBe(8);
});

it("regenerates only the pending guide in a nested pipeline without approval or repeating captures", async () => {
	const order: string[] = [];
	const { runtime } = create({
		agent: async (context) => {
			order.push(context.step.id);
			return { summary: "Whole feature" };
		},
		tool: async (context) => {
			order.push(context.step.id);
			return { headSha: "same", url: "https://github.com/test/repo/pull/1" };
		},
	});
	const child = workflow([
		{ id: "capture", name: "Capture", type: "tool", tool: "test" },
		agent("guide", { next: "handoff" }),
		{
			id: "handoff",
			name: "Handoff",
			type: "tool",
			tool: "handoff",
			next: "human-review",
		},
		{
			id: "human-review",
			name: "Human review",
			type: "tool",
			tool: "human-review",
			next: "merge",
		},
		{ id: "merge", name: "Merge", type: "tool", tool: "merge", next: "end" },
	]);
	const parent = validateWorkflows([
		...defaultWorkflows,
		child,
		{
			id: "parent",
			name: "Parent",
			steps: [
				{
					id: "pipeline",
					name: "Pipeline",
					type: "workflow",
					workflow: child.id,
				},
			],
		},
	]).at(-1)!;
	runtime.updateWorkflows([...defaultWorkflows, child, parent]);
	const run = start(runtime, parent);
	void runtime.launch(run);
	await vi.waitFor(() => expect(run.status).toBe("waiting"));
	const original = run.reviewGate!;
	const history = run.history.map((h) => h.step);
	await runtime.refreshGuide(run.id, original.id);
	await vi.waitFor(() => expect(run.status).toBe("waiting"));
	expect(order).toEqual([
		"capture",
		"guide",
		"handoff",
		"human-review",
		"guide",
		"handoff",
		"human-review",
	]);
	expect(run.history.slice(0, history.length).map((h) => h.step)).toEqual(
		history,
	);
	expect(run.humanDecisions).toBeUndefined();
	expect(run.reviewGate?.headSha).toBe(original.headSha);
	expect(run.reviewGate?.id).not.toBe(original.id);
	expect(() =>
		runtime.decide(run.id, {
			reviewId: original.id,
			headSha: original.headSha,
			decision: "approve",
		}),
	).toThrow("revision changed");
	await runtime.shutdown();
});

it("inherits chat through nested workflows with explicit workflow and step overrides", async () => {
	const observed: boolean[] = [];
	const { runtime, home } = create({
		agent: async (context) => {
			observed.push(context.chat!);
			return {};
		},
	});
	const definitions = validateWorkflows([
		...defaultWorkflows,
		{
			id: "chat-parent",
			name: "Parent",
			chat: true,
			steps: [
				{
					id: "nested",
					name: "Nested",
					type: "workflow",
					workflow: "chat-child",
				},
			],
		},
		{
			id: "chat-child",
			name: "Child",
			internal: true,
			steps: [
				agent("inherited"),
				agent("private", { chat: false }),
				agent("public", { chat: true }),
			],
		},
	]);
	runtime.updateWorkflows(definitions);
	const make = () =>
		runtime.create({
			title: "Chat",
			repositoryId: "repo",
			workspace: home,
			input: "",
			workflow: runtime.selectWorkflow([], "manual", "chat-parent"),
			triggerOrigin: {
				type: "manual",
				workflowId: "chat-parent",
				at: new Date().toISOString(),
			},
		});
	await runtime.launch(make());
	expect(observed).toEqual([true, false, true]);
	observed.length = 0;
	runtime.updateWorkflows(
		definitions.map((w) => (w.id === "chat-child" ? { ...w, chat: false } : w)),
	);
	await runtime.launch(make());
	expect(observed).toEqual([false, false, true]);
});
it("continues a finished simple run once with the same conversation and persists messages separately", async () => {
	let finish!: () => void;
	const { runtime, home } = create({
		simple: (run) => {
			expect(run.simpleExecution?.agent?.sessionId).toBe("native-thread");
			expect(run.simplePrompt).toBe("Follow up");
			return new Promise<void>((resolve) => {
				finish = resolve;
			});
		},
	});
	const run = runtime.create({
		title: "Chat",
		repositoryId: "repo",
		workspace: home,
		input: "Original",
		workflow: runtime.selectWorkflow([], "manual", "simple"),
		triggerOrigin: {
			type: "manual",
			workflowId: "simple",
			at: new Date().toISOString(),
		},
	});
	run.status = "completed";
	run.simpleExecution = {
		runner: "codex",
		userPrompt: "Original",
		agent: { runner: "codex", sessionId: "native-thread" },
	};
	runtime.save(run);
	runtime.continueSimple(run.id, "Follow up");
	expect(run.status).toBe("running");
	expect(() => runtime.continueSimple(run.id, "Duplicate")).toThrow();
	const message = runtime.recordChatMessage(run.id, "Follow up", "simple");
	expect(
		new WorkflowRuntime(home, {
			agent: async () => ({}),
			script: async () => ({}),
			tool: async () => ({}),
		}).chatMessages(run.id),
	).toEqual([message]);
	await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
	finish();
	await vi.waitFor(() => expect(run.status).toBe("completed"));
	expect(run.workspace).toBe(home);
	expect(run.input).toBe("Original");
});

it("keeps legacy run definitions stable on load and audits contract migration at retry", async () => {
	const { runtime, home } = create();
	const run = start(runtime, workflow([agent("work")]));
	run.status = "failed";
	run.error = "Interrupted legacy output";
	delete run.contractVersion;
	run.workflow.steps[0]!.prompt = "Frozen original prompt";
	run.workflowDefinitions = [run.workflow];
	run.checkpoint = {
		current: "work",
		visits: { work: 1 },
		active: {
			phase: "executing",
			agent: {
				runner: "codex",
				sessionId: "native",
				rejected: {
					output: "bad",
					issues: [{ path: "/", message: "Invalid" }],
					attempts: 1,
				},
			},
		},
	};
	runtime.save(run);
	const definitions = structuredClone(run.workflowDefinitions);
	const restarted = reload(home, {
		agent: async (context) => {
			expect(context.resumeAgent?.rejected).toMatchObject({
				output: "bad",
				attempts: 1,
			});
			expect(context.step.prompt).toBe("Frozen original prompt");
			return {};
		},
	});
	expect(restarted.get(run.id).workflowDefinitions).toEqual(definitions);
	restarted.retry(run.id);
	await vi.waitFor(() =>
		expect(restarted.get(run.id).status).toBe("completed"),
	);
	expect(restarted.get(run.id).contractVersion).toBe(2);
	expect(
		restarted
			.get(run.id)
			.events.some((event) =>
				event.message.startsWith("Migrated legacy output contract"),
			),
	).toBe(true);
	expect(restarted.get(run.id).workflowDefinitions).toEqual(definitions);
});

it("upgrades stock implementation blockers without replacing custom instructions or role settings", () => {
	const saved = structuredClone(defaultWorkflows);
	const shared = saved.find((item) => item.id === "factory-pipeline")!;
	const implementation = shared.steps.find((item) => item.id === "implement")!;
	implementation.prompt =
		'Implement the provided plan and use its assets. Follow repository conventions and appropriate verification. Return {"summary":"...","checks":["commands and outcomes"]}. Do not create or publish a PR; the next step handles delivery.';
	implementation.askQuestions = false;
	implementation.model = "custom-implementation-model";
	const upgraded = validateWorkflows(upgradeWorkflows(saved));
	const role = upgraded
		.find((item) => item.id === "factory-pipeline")!
		.steps.find((item) => item.id === "implement")!;
	expect(role.askQuestions).toBe(true);
	expect(role.model).toBe("custom-implementation-model");
	expect(upgradeWorkflows(upgraded)).toEqual(upgraded);
	implementation.prompt = "Custom implementation instructions";
	const custom = validateWorkflows(upgradeWorkflows(saved))
		.find((item) => item.id === "factory-pipeline")!
		.steps.find((item) => item.id === "implement")!;
	expect(custom.prompt).toBe(implementation.prompt);
	expect(custom.askQuestions).toBe(false);
});

it("runs nested intensive fanout at limit one and cancels queued leaves without deadlock", async () => {
	const { MachineCapacity } = await import("../src/MachineCapacity.js");
	const { capacityRunStatus } = await import(
		"../src/factory/WorkflowRuntime.js"
	);
	const directory = mkdtempSync(join(tmpdir(), "runtime-capacity-"));
	homes.push(directory);
	const capacity = new MachineCapacity(1, directory);
	const blocker = await capacity.acquireLease();
	const script = vi.fn(async () => ({ done: true }));
	const { runtime } = create({ capacity, script });
	const definition = workflow([
		{
			id: "parallel",
			name: "Parallel",
			type: "fanout",
			groups: [
				[{ id: "a", name: "A", type: "script", script: "a" }],
				[{ id: "b", name: "B", type: "tool", tool: "exec", args: ["b"] }],
			],
		},
	]);
	const run = start(runtime, definition);
	const done = runtime.launch(run);
	await vi.waitFor(() =>
		expect(capacityRunStatus(run)).toBe("capacity-waiting"),
	);
	expect(Object.keys(run.capacityLeaves!)).toEqual([
		"parallel/0/a",
		"parallel/1/b",
	]);
	runtime.stop(run.id);
	await done;
	await blocker.release();
	expect(script).not.toHaveBeenCalled();
	expect((await capacity.snapshot()).queued).toBe(0);
	const another = start(runtime, definition);
	await runtime.launch(another);
	expect(another.status).toBe("completed");
	expect(script).toHaveBeenCalledOnce();
	expect((await capacity.snapshot()).active).toBe(0);
});
it("rejects intensive passive waits and preserves explicit lightweight scripts in nested recipes", () => {
	expect(() =>
		workflow([
			{
				id: "wait",
				name: "CI",
				type: "tool",
				tool: "ci",
				computeIntensive: true,
			},
		]),
	).toThrow(/Passive wait/);
	expect(() =>
		workflow([
			{
				id: "parent",
				name: "Parent",
				type: "fanout",
				computeIntensive: true,
				groups: [[agent("child")]],
			},
		]),
	).toThrow();
	const definition = workflow([
		{
			id: "script",
			name: "Light",
			type: "script",
			script: "echo ready",
			computeIntensive: false,
		},
	]);
	expect(definition.steps[0]!.computeIntensive).toBe(false);
});

it("admits nested workflow leaves at limit one while passive CI consumes no slot", async () => {
	const { MachineCapacity } = await import("../src/MachineCapacity.js");
	const directory = mkdtempSync(join(tmpdir(), "nested-capacity-"));
	homes.push(directory);
	const capacity = new MachineCapacity(1, directory);
	let finishCI!: () => void;
	const tool = vi.fn(
		() =>
			new Promise<unknown>((resolve) => {
				finishCI = () => resolve({ done: true });
			}),
	);
	const script = vi.fn(async () => ({ done: true }));
	const { runtime } = create({ capacity, script, tool });
	const child = {
		...workflow([
			{ id: "heavy", name: "Heavy", type: "script", script: "echo {}" },
		]),
		id: "child",
	};
	const parent = workflow(
		[
			{
				id: "parallel",
				name: "Parallel",
				type: "fanout",
				groups: [
					[{ id: "call", name: "Child", type: "workflow", workflow: "child" }],
					[{ id: "ci", name: "CI", type: "tool", tool: "ci" }],
				],
			},
		],
		[child],
	);
	runtime.updateWorkflows([...defaultWorkflows, parent, child]);
	const run = start(runtime, parent),
		done = runtime.launch(run);
	await vi.waitFor(() => expect(script).toHaveBeenCalledOnce());
	await vi.waitFor(() =>
		expect(run.capacityLeaves).toMatchObject({
			"parallel/1/ci": { phase: "waiting-ci" },
		}),
	);
	await vi.waitFor(
		async () => expect((await capacity.snapshot()).active).toBe(0),
		{ timeout: 10000 },
	);
	const next = await capacity.acquireLease();
	await next.release();
	finishCI();
	await done;
	expect(run.status).toBe("completed");
	expect(run.history.map((item) => item.step)).toContain(
		"parallel/0/call/heavy",
	);
});

it("upgrades a coherent screenshot recipe to QA atomically, keeps custom behavior and frozen run definitions", async () => {
	const saved = structuredClone(defaultWorkflows);
	const pipeline = saved.find((w) => w.id === "factory-pipeline")!;
	for (const legacy of legacyScreenshotSteps)
		pipeline.steps[pipeline.steps.findIndex((s) => s.id === legacy.id)] =
			structuredClone(legacy);
	pipeline.steps.find((s) => s.id === "capture")!.model =
		"custom-capture-model";
	const upgraded = validateWorkflows(upgradeWorkflows(saved));
	const qa = upgraded.find((w) => w.id === "factory-pipeline")!;
	expect(qa.steps.find((s) => s.id === "visual-scope")).toMatchObject({
		qaContract: "qa-v1",
		branches: [],
	});
	expect(qa.steps.find((s) => s.id === "capture")).toMatchObject({
		qaContract: "qa-v1",
		model: "custom-capture-model",
	});
	expect(upgradeWorkflows(upgraded)).toEqual(upgraded);
	pipeline.steps.find((s) => s.id === "visual-review")!.prompt =
		"Custom screenshot requirements";
	const custom = validateWorkflows(upgradeWorkflows(saved)).find(
		(w) => w.id === "factory-pipeline",
	)!;
	// Handoff recovery is independent of the QA role migration: the existing
	// CI fixer still handles late conflicts while custom screenshot roles stay intact.
	expect(custom.steps.find((s) => s.id === "handoff")!.branches).toEqual([
		{ when: { path: "fix", equals: true }, next: "ci-fix" },
	]);
	expect(
		custom.steps.filter((s) =>
			legacyScreenshotSteps.some((l) => l.id === s.id && l.id !== "handoff"),
		),
	).toEqual(
		pipeline.steps.filter((s) =>
			legacyScreenshotSteps.some((l) => l.id === s.id && l.id !== "handoff"),
		),
	);
	const { runtime } = create();
	const legacyDefinition = {
		...defaultWorkflows.find((w) => w.id === "factory")!,
		steps: structuredClone(legacyScreenshotSteps),
	};
	const run = start(runtime, legacyDefinition);
	const frozen = structuredClone(run.workflow);
	runtime.save(run);
	const restored = new WorkflowRuntime(
		runtime.directory.replace(/\/factory$/, ""),
		{
			agent: async () => ({}),
			script: async () => ({}),
			tool: async () => ({}),
		},
	);
	expect(restored.get(run.id).workflow).toEqual(frozen);
	await restored.shutdown();
	await runtime.shutdown();
});

it("retries blocked nonvisual QA after restart and waits again without waiving criteria", async () => {
	const tool = vi.fn(async (ctx: ExecutionContext) =>
		ctx.run.answers.length < 2
			? {
					approved: false,
					qaBlocked: true,
					questions: [
						"CLI fixture account is unavailable. Restore access, then explain how QA can run the required save check.",
					],
				}
			: { approved: true },
	);
	const agentHook = vi.fn(async (ctx: ExecutionContext) => {
		if (ctx.step.id === "capture")
			expect((ctx.input as { answers: unknown[] }).answers).toHaveLength(
				ctx.run.answers.length,
			);
		return { qaContract: "qa-v1", results: [] };
	});
	const { home, runtime } = create({ tool, agent: agentHook });
	const definition = workflow([
		agent("capture", {
			inputs: ["visual-scope"],
			qaContract: "qa-v1",
			next: "visual-review",
		}),
		agent("visual-review", { next: "visual-gate", qaContract: "qa-v1" }),
		{
			id: "visual-gate",
			name: "QA gate",
			type: "tool",
			tool: "visual-gate",
			next: "end",
			qaContract: "qa-v1",
		},
	]);
	const run = start(runtime, definition);
	run.outputs["visual-scope"] = { changed: false, areas: [] };
	const execution = runtime.launch(run);
	await vi.waitFor(() => expect(run.status).toBe("waiting"));
	const prefix = structuredClone(run.history);
	const frozen = structuredClone(run.workflow);
	await runtime.shutdown();
	await execution;
	const restored = new WorkflowRuntime(home, {
		tool,
		agent: agentHook,
		script: async () => ({}),
	});
	const same = restored.get(run.id);
	restored.resumeAll();
	await vi.waitFor(() => expect(same.status).toBe("waiting"));
	expect(same.history).toEqual(prefix);
	expect(same.workflow).toEqual(frozen);
	restored.answer(same.id, "Access still unavailable; please approve anyway");
	await vi.waitFor(() =>
		expect(
			same.status === "waiting" && same.history.length > prefix.length,
		).toBe(true),
	);
	expect(same.outputs["visual-gate"]).toMatchObject({
		approved: false,
		qaBlocked: true,
	});
	restored.answer(
		same.id,
		"Account restored; execute CLI save with fixture 42",
	);
	await vi.waitFor(() => expect(same.status).toBe("completed"));
	expect(same.answers).toHaveLength(2);
	expect(
		agentHook.mock.calls.filter(([c]) => c.step.id === "capture"),
	).toHaveLength(3);
	await restored.shutdown();
});

it("upgrades the original stock end-at-handoff recipe with QA and its human checkpoint together", () => {
	const saved = structuredClone(defaultWorkflows);
	const pipeline = saved.find((w) => w.id === "factory-pipeline")!;
	for (const legacy of legacyScreenshotSteps)
		pipeline.steps[pipeline.steps.findIndex((s) => s.id === legacy.id)] =
			structuredClone(legacy);
	pipeline.steps = pipeline.steps.filter(
		(s) => !["human-review", "human-fix", "merge"].includes(s.id),
	);
	pipeline.steps.find((s) => s.id === "handoff")!.next = "end";
	const upgraded = validateWorkflows(upgradeWorkflows(saved));
	const qa = upgraded.find((w) => w.id === "factory-pipeline")!;
	expect(qa.steps.find((s) => s.id === "handoff")).toMatchObject({
		qaContract: "qa-v1",
		next: "human-review",
	});
	expect(qa.steps.some((s) => s.id === "human-review")).toBe(true);
	expect(upgradeWorkflows(upgraded)).toEqual(upgraded);
});

it("preserves a screenshot recipe with customized result handling or nonvisual routing", () => {
	for (const customize of [
		(step: Workflow["steps"][number]) => {
			step.json = false;
		},
		(step: Workflow["steps"][number]) => {
			step.askQuestions = true;
		},
		(step: Workflow["steps"][number]) => {
			step.branches = [];
		},
	]) {
		const saved = structuredClone(defaultWorkflows),
			pipeline = saved.find((w) => w.id === "factory-pipeline")!;
		for (const legacy of legacyScreenshotSteps)
			pipeline.steps[pipeline.steps.findIndex((s) => s.id === legacy.id)] =
				structuredClone(legacy);
		customize(pipeline.steps.find((s) => s.id === "visual-scope")!);
		const updated = validateWorkflows(upgradeWorkflows(saved)).find(
			(w) => w.id === "factory-pipeline",
		)!;
		expect(updated.steps.find((s) => s.id === "visual-scope")).toEqual(
			pipeline.steps.find((s) => s.id === "visual-scope"),
		);
		expect(
			updated.steps.find((s) => s.id === "capture")!.qaContract,
		).toBeUndefined();
	}
});
