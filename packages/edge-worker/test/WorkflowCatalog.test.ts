import { createHash } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
	defaultWorkflows,
	legacyReviewSteps,
} from "../src/factory/defaultWorkflows.js";
import { getLaunchFields } from "../src/factory/LaunchFields.js";
import { StepSchema, WorkflowSchema } from "../src/factory/Workflow.js";
import {
	WorkflowCatalog,
	workflowRoles,
} from "../src/factory/WorkflowCatalog.js";
import {
	type RuntimeHooks,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { SessionSemaphore } from "../src/RunnerConcurrency.js";
import { FactoryServer } from "./fixtures/authenticated-factory.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
function fixture(hooks: Partial<RuntimeHooks> = {}) {
	const home = mkdtempSync(join(tmpdir(), "catalog-129-"));
	roots.push(home);
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		tool: async () => ({}),
		script: async () => ({}),
		...hooks,
	});
	return { runtime, home, path: join(home, "factory", "workflows.json") };
}
const legacy = () =>
	structuredClone(defaultWorkflows).map((w) =>
		w.id === "factory-pipeline"
			? { ...w, steps: legacyReviewSteps.map((s) => StepSchema.parse(s)) }
			: w,
	);
function local(
	runtime: WorkflowRuntime,
	id = "custom",
	steps: unknown[] = [
		{ id: "work", name: "Work", type: "agent", prompt: "Execute fixture" },
	],
) {
	const workflow = WorkflowSchema.parse({ id, name: id, steps });
	runtime.updateWorkflows([...runtime.listWorkflows(), workflow]);
	return workflow;
}
function create(
	runtime: WorkflowRuntime,
	workflow = runtime.selectWorkflow([], "manual", "factory"),
) {
	return runtime.create({
		workflow,
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
		repositoryId: "repo",
		workspace: "/tmp",
		input: "Fixture",
	});
}
it.each([
	false,
	true,
])("adopts installed stock behavior and maps legacy review preferences atomically (object=%s)", (object) => {
	const { home, runtime, path } = fixture();
	const definitions = legacy();
	definitions.find((w) => w.id === "simple")!.launchFields = getLaunchFields(
		definitions.find((w) => w.id === "simple")!,
	);
	const reviewer = definitions
		.find((w) => w.id === "factory-pipeline")!
		.steps.find((s) => s.id === "code-review")!;
	Object.assign(reviewer, {
		runner: "codex",
		model: "gpt-6.1-sol",
		reasoningEffort: "high",
		serviceTier: "fast",
	});
	definitions.find((w) => w.id === "factory")!.labels = ["my-factory"];
	const bytes = JSON.stringify(
		object
			? { workflows: definitions, defaultWorkflow: "factory" }
			: definitions,
	);
	writeFileSync(path, bytes);
	const migrated = new WorkflowRuntime(home, (runtime as any).hooks);
	const configuration = migrated.catalog.read();
	expect(configuration.locals).toEqual([]);
	expect(configuration.defaultWorkflow).toBe(object ? "factory" : "simple");
	expect(readFileSync(configuration.migration!.backup, "utf8")).toBe(bytes);
	const pipeline = migrated
		.listWorkflows()
		.find((w) => w.id === "factory-pipeline")!;
	const reviewers = workflowRoles(pipeline.steps).filter((r) =>
		r.role.startsWith("specialist-review/"),
	);
	expect(reviewers).toHaveLength(6);
	for (const { step } of reviewers)
		expect(step).toMatchObject({
			runner: "codex",
			model: "gpt-6.1-sol",
			reasoningEffort: "high",
			serviceTier: "fast",
		});
	expect(pipeline.steps.some((s) => s.reviewContract === "inventory-v1")).toBe(
		true,
	);
	expect(pipeline.steps.find((s) => s.id === "guide")).toMatchObject({
		videoContract: "video-v1",
		guideContract: "brief-v1",
	});
	expect(migrated.selectWorkflow(["my-factory"], "manual").id).toBe("factory");
	const saved = readFileSync(path, "utf8");
	new WorkflowRuntime(home, (runtime as any).hooks);
	expect(readFileSync(path, "utf8")).toBe(saved);
	expect(JSON.parse(saved).workflows).toBeUndefined();
});
it("preserves genuine custom graph behavior, private dependencies and default intent", () => {
	const { home, runtime, path } = fixture();
	const definitions = legacy();
	definitions.find((w) => w.id === "factory-pipeline")!.steps[0]!.prompt =
		"A genuinely different prompt";
	writeFileSync(
		path,
		JSON.stringify({ workflows: definitions, defaultWorkflow: "factory" }),
	);
	const migrated = new WorkflowRuntime(home, (runtime as any).hooks),
		mapping = migrated.catalog.read().migration!.mappings;
	expect(migrated.getDefaultWorkflow()).toBe(mapping.factory);
	expect(mapping["factory-pipeline"]).toBeDefined();
	const root = migrated.selectWorkflow([], "manual", mapping.factory);
	expect(root.steps[0]!.workflow).not.toBe("factory-pipeline");
	const child = migrated
		.listWorkflows()
		.find((w) => w.id === root.steps[0]!.workflow)!;
	expect(child.steps[0]!.prompt).toBe("A genuinely different prompt");
	expect(
		migrated.listWorkflows().find((w) => w.id === "factory-pipeline")!.steps[0]!
			.prompt,
	).not.toBe(child.steps[0]!.prompt);
	const count = migrated.listWorkflows().length;
	expect(new WorkflowCatalog(join(home, "factory")).list()).toHaveLength(count);
});
it("retains unknown Simple behavior as a routing conflict with recoverable bytes", () => {
	const { home, runtime, path } = fixture();
	const definitions = structuredClone(defaultWorkflows);
	definitions[0]!.description = "Custom native behavior";
	definitions[0]!.labels = ["custom-simple"];
	const bytes = JSON.stringify({
		workflows: definitions,
		defaultWorkflow: "factory",
	});
	writeFileSync(path, bytes);
	const migrated = new WorkflowRuntime(home, (runtime as any).hooks);
	expect(() => migrated.selectWorkflow(["custom-simple"], "manual")).toThrow(
		"unavailable",
	);
	expect(migrated.selectWorkflow([], "manual").id).toBe("factory");
	const state = migrated.catalog.read();
	expect(readFileSync(state.migration!.backup, "utf8")).toBe(bytes);
	expect(
		state.locals.some((w) => state.provenance[w.id]?.source === "simple"),
	).toBe(false);
	migrated.catalog.resolveSimpleConflict();
	expect(migrated.selectWorkflow(["custom-simple"], "manual").id).toBe(
		"simple",
	);
});
it("rejects stock behavior edits, internal identity collisions and native Simple fork/import bypasses", () => {
	const { runtime, path } = fixture();
	const bytes = readFileSync(path, "utf8");
	const modified = runtime.listWorkflows();
	modified.find((w) => w.id === "factory-pipeline")!.steps[0]!.prompt =
		"Injected";
	expect(() => runtime.updateWorkflows(modified)).toThrow("read-only");
	expect(readFileSync(path, "utf8")).toBe(bytes);
	expect(() => runtime.forkWorkflow("simple")).toThrow("cannot be forked");
	const imported = runtime.catalog.read();
	imported.locals.push({ ...defaultWorkflows[1]!, id: "factory-pipeline" });
	expect(() => runtime.catalog.import(imported)).toThrow("reserved");
	const native = runtime.catalog.read();
	native.locals.push({ ...defaultWorkflows[0]!, id: "native-alias" });
	expect(() => runtime.catalog.import(native)).toThrow("needs steps");
});
it("creates independent private fork graphs and keeps standards authoritative at new-run acceptance", () => {
	const { runtime } = fixture();
	const first = runtime.forkWorkflow("factory"),
		second = runtime.forkWorkflow("factory");
	expect(first.steps[0]!.workflow).not.toBe(second.steps[0]!.workflow);
	expect(first.labels).toEqual([]);
	expect(runtime.getDefaultWorkflow()).toBe("simple");
	const definitions = runtime.listWorkflows(),
		privateChild = definitions.find((w) => w.id === first.steps[0]!.workflow)!;
	privateChild.steps[0]!.prompt = "Only first fork";
	runtime.updateWorkflows(definitions);
	expect(
		runtime.listWorkflows().find((w) => w.id === second.steps[0]!.workflow)!
			.steps[0]!.prompt,
	).not.toBe("Only first fork");
	const forged = {
		...defaultWorkflows[1]!,
		steps: [
			StepSchema.parse({
				id: "inject",
				name: "Injection",
				type: "script",
				script: "touch /tmp/unauthorized",
			}),
		],
	};
	expect(create(runtime, forged).workflow).toEqual(
		runtime.listWorkflows().find((w) => w.id === "factory"),
	);
});
it("preserves unmatched preferences visibly across upgrades and validates compatible edits", () => {
	const { home, runtime, path } = fixture();
	const state = runtime.catalog.read();
	state.preferences["factory-pipeline"] = {
		"removed-role": { runner: "codex", model: "old" },
		clarify: { runner: "opencode", modelVariant: "careful" },
	};
	writeFileSync(path, JSON.stringify(state));
	const migrated = new WorkflowRuntime(home, (runtime as any).hooks);
	expect(migrated.catalog.read().inactive).toEqual([
		{
			workflow: "factory-pipeline",
			role: "removed-role",
			settings: { runner: "codex", model: "old" },
			reason: "Role is absent from the installed standard",
		},
	]);
	expect(
		migrated.listWorkflows().find((w) => w.id === "factory-pipeline")!.steps[0],
	).toMatchObject({ runner: "opencode", modelVariant: "careful" });
	expect(() =>
		migrated.updatePreferences("factory-pipeline", {
			clarify: { runner: "gemini", reasoningEffort: "high" },
		}),
	).toThrow("not supported");
	expect(() =>
		migrated.catalog.updateInactive(0, {
			workflow: "__proto__",
			role: "polluted",
		}),
	).toThrow("current bundled");
	expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
	migrated.catalog.updateInactive(0, {
		workflow: "factory-pipeline",
		role: "implement",
	});
	expect(
		migrated.catalog.read().preferences["factory-pipeline"]!.implement,
	).toMatchObject({ runner: "codex", model: "old" });
});
it("leaves malformed legacy input recoverable and recovers interrupted atomic staging", () => {
	const { home, runtime, path } = fixture();
	writeFileSync(path, "{bad");
	expect(() => new WorkflowRuntime(home, (runtime as any).hooks)).toThrow();
	expect(readFileSync(path, "utf8")).toBe("{bad");
	const bytes = JSON.stringify(legacy());
	writeFileSync(path, bytes);
	writeFileSync(`${path}.tmp`, "invalid staged data");
	const migrated = new WorkflowRuntime(home, (runtime as any).hooks);
	expect(existsSync(migrated.catalog.read().migration!.backup)).toBe(true);
	expect(migrated.catalog.read().locals).toEqual([]);
});
it("blocks exact accepted dependencies, keeps private forks eligible, and preserves individual Resume across restart", async () => {
	const calls: string[] = [];
	const { home, runtime } = fixture({
		agent: async (ctx) => {
			calls.push(ctx.step.id);
			return {};
		},
	});
	const fork = runtime.forkWorkflow("factory");
	runtime.setWorkflowEnabled("factory-pipeline", false);
	expect(() => runtime.selectWorkflow([], "manual", "factory")).toThrow(
		"factory-pipeline",
	);
	expect(runtime.selectWorkflow([], "manual", fork.id).id).toBe(fork.id);
	runtime.setWorkflowEnabled("factory-pipeline", true);
	const workflow = local(runtime, "wait", [
		{
			id: "work",
			name: "Work",
			type: "agent",
			prompt: "Wait",
			askQuestions: true,
		},
	]);
	(runtime as any).hooks.agent = async () => ({ questions: ["Which choice?"] });
	const run = create(runtime, workflow),
		accepted = structuredClone(run.workflow),
		execution = runtime.launch(run);
	await vi.waitFor(() => expect(run.status).toBe("waiting"));
	runtime.setWorkflowEnabled("wait", false);
	await execution;
	expect(run.status).toBe("blocked");
	expect(run.questions).toEqual(["Which choice?"]);
	expect(() => runtime.answer(run.id, "A")).toThrow("disabled");
	runtime.setWorkflowEnabled("wait", true);
	expect(() => runtime.retry(run.id)).toThrow("disabled");
	const restarted = new WorkflowRuntime(home, (runtime as any).hooks);
	restarted.resumeAll();
	expect(restarted.get(run.id).status).toBe("blocked");
	expect(restarted.get(run.id).workflow).toEqual(accepted);
	restarted.resume(run.id);
	await vi.waitFor(() => expect(restarted.get(run.id).status).toBe("waiting"));
	expect(restarted.get(run.id).questions).toEqual(["Which choice?"]);
	restarted.stop(run.id);
	await restarted.shutdown();
});
it("interrupts executing work and rejects late results and preparation after disabling", async () => {
	let finish!: () => void;
	let started!: () => void;
	const start = new Promise<void>((resolve) => (started = resolve));
	const subsequent = vi.fn();
	const { runtime } = fixture({
		agent: async (ctx) => {
			started();
			await new Promise<void>((resolve) => {
				finish = resolve;
				ctx.signal.addEventListener("abort", resolve, { once: true });
			});
			return { summary: "late" };
		},
		script: subsequent,
	});
	const workflow = local(runtime, "active", [
		{ id: "work", name: "Work", type: "agent", prompt: "Wait" },
		{ id: "later", name: "Later", type: "script", script: "true" },
	]);
	const run = create(runtime, workflow),
		execution = runtime.launch(run);
	await start;
	runtime.setWorkflowEnabled("active", false);
	expect(() => runtime.resume(run.id)).toThrow("finished stopping");
	finish();
	await execution;
	expect(run.status).toBe("blocked");
	expect(run.history).toEqual([]);
	expect(subsequent).not.toHaveBeenCalled();
});
it("cancels queued leaves and releases capacity without invoking the disabled tool", async () => {
	const capacity = new SessionSemaphore(1),
		lease = await capacity.acquireLease(),
		invoke = vi.fn();
	const { runtime } = fixture({ capacity, tool: invoke });
	const workflow = local(runtime, "queued", [
		{
			id: "work",
			name: "Work",
			type: "tool",
			tool: "custom",
			computeIntensive: true,
		},
	]);
	const run = create(runtime, workflow),
		execution = runtime.launch(run);
	await vi.waitFor(() => expect(capacity.waiting).toBe(1));
	runtime.setWorkflowEnabled("queued", false);
	await execution;
	expect(capacity.waiting).toBe(0);
	await lease.release();
	expect(capacity.active).toBe(0);
	expect(invoke).not.toHaveBeenCalled();
});
it("binds disable confirmation to current configuration and affected runs through the protected API", async () => {
	const { runtime, home } = fixture();
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => create(runtime),
		stop: (id) => runtime.stop(id),
	});
	try {
		const inject = (options: any) =>
			server.app.inject({ ...options, headers: { "x-factory-request": "1" } });
		const before = (
			await inject({ url: "/api/workflows/factory/availability" })
		).json();
		expect(
			(
				await inject({
					url: "/api/workflows/factory/availability",
					method: "PUT",
					payload: { enabled: false },
				})
			).statusCode,
		).toBe(409);
		create(runtime);
		expect(
			(
				await inject({
					url: "/api/workflows/factory/availability",
					method: "PUT",
					payload: { enabled: false, confirm: true, token: before.token },
				})
			).statusCode,
		).toBe(409);
		const current = (
			await inject({ url: "/api/workflows/factory/availability" })
		).json();
		expect(current.runs).toHaveLength(1);
		expect(
			(
				await inject({
					url: "/api/workflows/factory/availability",
					method: "PUT",
					payload: { enabled: false, confirm: true, token: current.token },
				})
			).statusCode,
		).toBe(200);
		expect(
			(await inject({ url: "/api/config" }))
				.json()
				.workflows.find((w: any) => w.id === "factory"),
		).toMatchObject({ ownership: "bundled", enabled: false });
		expect(
			new WorkflowCatalog(join(home, "factory")).read().enabled.factory,
		).toBe(false);
	} finally {
		await runtime.shutdown();
		await server.stop();
	}
});

it("saves dashboard-resolved agent preferences without admitting launch-field edits", async () => {
	const { runtime } = fixture();
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => create(runtime),
		stop: (id) => runtime.stop(id),
	});
	try {
		const config = (await server.app.inject({ url: "/api/config" })).json();
		const pipeline = config.workflows.find(
			(w: any) => w.id === "factory-pipeline",
		);
		const role = workflowRoles(pipeline.steps).find(
			(r) => r.role === "specialist-review/security-review",
		)!;
		role.step.model = "gpt-6-sol";
		const saved = await server.app.inject({
			url: "/api/workflows",
			method: "PUT",
			headers: { "x-factory-request": "1" },
			payload: {
				workflows: config.workflows,
				defaultWorkflow: config.defaultWorkflow,
			},
		});
		expect(saved.statusCode, saved.body).toBe(200);
		expect(
			runtime.catalog.read().preferences["factory-pipeline"]![role.role]!.model,
		).toBe("gpt-6-sol");
		config.workflows.find((w: any) => w.id === "simple").launchFields[0].label =
			"Changed bundled field";
		expect(
			(
				await server.app.inject({
					url: "/api/workflows",
					method: "PUT",
					headers: { "x-factory-request": "1" },
					payload: {
						workflows: config.workflows,
						defaultWorkflow: config.defaultWorkflow,
					},
				})
			).statusCode,
		).toBe(409);
	} finally {
		await runtime.shutdown();
		await server.stop();
	}
});

it("retains accepted admission preferences through setup and later upgrades", () => {
	const { home, runtime } = fixture();
	runtime.updatePreferences("simple", {
		native: { runner: "codex", model: "accepted-model" },
	});
	const launch = runtime.selectLaunch([], "manual", "simple");
	runtime.updatePreferences("simple", {
		native: { runner: "claude", model: "later-model" },
	});
	const run = runtime.create(
		{
			workflow: launch.workflow,
			workflowDefinitions: launch.workflowDefinitions,
			triggerOrigin: {
				type: "manual",
				workflowId: "simple",
				at: new Date().toISOString(),
			},
			repositoryId: "repo",
			workspace: "/tmp",
			input: "Accepted",
		},
		launch,
	);
	expect(run.runner).toBe("codex");
	expect(run.model).toBe("accepted-model");
	delete run.workflow.chat;
	runtime.save(run);
	const restored = new WorkflowRuntime(home, (runtime as any).hooks);
	expect(restored.get(run.id).workflow.chat).toBeUndefined();
	expect(restored.get(run.id).model).toBe("accepted-model");
	const factoryLaunch = runtime.selectLaunch([], "manual", "factory");
	runtime.updatePreferences("factory-pipeline", {
		clarify: { runner: "codex", model: "later" },
	});
	const frozen = runtime.create(
		{
			workflow: factoryLaunch.workflow,
			triggerOrigin: {
				type: "manual",
				workflowId: "factory",
				at: new Date().toISOString(),
			},
			repositoryId: "repo",
			workspace: "/tmp",
			input: "Frozen",
		},
		factoryLaunch,
	);
	expect(frozen.workflowDefinitions).toEqual(factoryLaunch.workflowDefinitions);
});

it("removes disabled fork graphs with their metadata and preserves export/import", () => {
	const { runtime } = fixture();
	const fork = runtime.forkWorkflow("factory");
	const privateIds = new Set([
		fork.id,
		...Object.values(runtime.catalog.read().provenance[fork.id]!.dependencies),
	]);
	runtime.setWorkflowEnabled(fork.id, false);
	runtime.updateWorkflows(
		runtime.listWorkflows().filter((w) => !privateIds.has(w.id)),
	);
	const exported = runtime.catalog.read();
	expect(exported.enabled[fork.id]).toBeUndefined();
	expect(exported.provenance[fork.id]).toBeUndefined();
	runtime.importWorkflows(exported);
	expect(runtime.listWorkflows().some((w) => privateIds.has(w.id))).toBe(false);
});
it.each([
	"partial",
	"staging",
])("recovers migration after interruption at %s backup creation", (boundary) => {
	const { home, runtime, path } = fixture();
	const bytes = JSON.stringify({
		workflows: legacy(),
		defaultWorkflow: "factory",
	});
	writeFileSync(path, bytes);
	const hash = createHash("sha256").update(bytes).digest("hex");
	// Match the digest-named backup path used by the migration receipt.
	const realBackup = `${path}.backup-${hash}`;
	const name =
		boundary === "partial" ? realBackup : `${realBackup}.abandoned.tmp`;
	writeFileSync(name, bytes.slice(0, 101));
	const recovered = new WorkflowRuntime(home, (runtime as any).hooks);
	expect(readFileSync(recovered.catalog.read().migration!.backup, "utf8")).toBe(
		bytes,
	);
	expect(recovered.catalog.read().locals).toEqual([]);
	expect(
		new WorkflowRuntime(home, (runtime as any).hooks).catalog.read(),
	).toEqual(recovered.catalog.read());
});

it("preserves original config and a genuinely conflicting migration backup", () => {
	const { home, runtime, path } = fixture();
	const bytes = JSON.stringify({
		workflows: legacy(),
		defaultWorkflow: "factory",
	});
	writeFileSync(path, bytes);
	const hash = createHash("sha256").update(bytes).digest("hex");
	const backup = `${path}.backup-${hash}`;
	writeFileSync(backup, "unrelated configuration");
	expect(() => new WorkflowRuntime(home, (runtime as any).hooks)).toThrow(
		"backup collision",
	);
	expect(readFileSync(path, "utf8")).toBe(bytes);
	expect(readFileSync(backup, "utf8")).toBe("unrelated configuration");
});
