import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentRunnerConfig,
	IAgentRunner,
	RunTitleJob,
	SDKMessage,
} from "cyrus-core";
import { afterEach, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import {
	getLaunchFields,
	LaunchRequestSchema,
	resolveLaunchRequest,
} from "../src/factory/LaunchFields.js";
import {
	buildTitleContext,
	parseRunTitle,
	RunTitleGenerator,
} from "../src/factory/RunTitleGenerator.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import { SessionSemaphore } from "../src/RunnerConcurrency.js";

const homes: string[] = [];
afterEach(() => {
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
function home() {
	const path = mkdtempSync(join(tmpdir(), "run-titles-"));
	homes.push(path);
	return path;
}
function job(): RunTitleJob {
	return {
		state: "pending",
		context: "Task",
		settings: { runner: "codex", model: "title-model" },
	};
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
function setup(deadline = 1000, slots = new SessionSemaphore(2)) {
	const directory = home(),
		completion = deferred<void>();
	let config!: AgentRunnerConfig;
	const start = vi.fn(async () => {
		await completion.promise;
		return { sessionId: "auxiliary" };
	});
	const stop = vi.fn();
	const runner = { start, stop } as unknown as IAgentRunner;
	const buildConfig = vi.fn(async () => ({ workingDirectory: directory }));
	const update = vi.fn();
	const create = vi.fn((_job: RunTitleJob, next: AgentRunnerConfig) => {
		config = next;
		return runner;
	});
	const generator = new RunTitleGenerator(
		directory,
		slots,
		{ buildConfig, createRunner: create, update },
		deadline,
	);
	const emit = (message: unknown) => config.onMessage?.(message as SDKMessage);
	return {
		directory,
		completion,
		config: () => config,
		start,
		stop,
		create,
		update,
		generator,
		slots,
		emit,
	};
}

it("bounds UTF-8/escaped task data and preserves source context without forwarding a legacy title", () => {
	const source = "https://taskbot.apps.janjaap.de/p/test/t/68";
	const text = buildTitleContext({
		source,
		instructions: "😀\u0000".repeat(20000),
		ticket: {
			title: "Add run titles",
			identifier: "TEST-68",
			description: "Body".repeat(2000),
		},
		inputs: { title: "Forbidden", extra: "large".repeat(10000) },
	});
	expect(Buffer.byteLength(text)).toBeLessThanOrEqual(8192);
	const packet = JSON.parse(text);
	expect(packet.source).toBe(source);
	expect(packet.ticketIdentifier).toBe("TEST-68");
	expect(packet.ticketTitle).toBe("Add run titles");
	expect(text).toContain("shortened");
	expect(text).not.toContain("Forbidden");
});
it.each([
	'{"title":""}',
	'{"title":12}',
	"not JSON",
	JSON.stringify({ title: "x".repeat(121) }),
])("rejects invalid title output: %s", (text) => {
	expect(() => parseRunTitle(text)).toThrow();
});
it("confines auxiliary cleanup to its job directory for external session IDs", async () => {
	const test = setup();
	test.generator.start("..", job());
	await vi.waitFor(() => expect(test.start).toHaveBeenCalledOnce());
	mkdirSync(join(test.directory, "factory"), { recursive: true });
	const sentinel = join(test.directory, "factory", "keep");
	writeFileSync(sentinel, "persisted runs");
	await test.emit({
		type: "result",
		is_error: false,
		result: '{"title":"Name external session safely"}',
	});
	test.completion.resolve();
	await vi.waitFor(() => expect(test.update).toHaveBeenCalledOnce());
	expect(existsSync(sentinel)).toBe(true);
	expect(
		existsSync(join(test.directory, "factory", "title-jobs", "%2E%2E")),
	).toBe(false);
	await test.generator.shutdown();
});
it("normalizes title whitespace and accepts fenced JSON", () => {
	expect(
		parseRunTitle('```json\n{"title":"  Add  run\\n titles  "}\n```'),
	).toBe("Add run titles");
});
it("deduplicates pending work and updates only after a valid result, cleaning up the runner", async () => {
	const test = setup(),
		snapshot = job();
	test.generator.start("run", snapshot);
	test.generator.start("run", snapshot);
	await vi.waitFor(() => expect(test.start).toHaveBeenCalledOnce());
	expect(test.update).not.toHaveBeenCalled();
	await test.emit({
		type: "result",
		is_error: false,
		result: '{"title":"Add automatic run titles"}',
	});
	test.completion.resolve();
	await vi.waitFor(() =>
		expect(test.update).toHaveBeenCalledWith(
			"run",
			{ ...snapshot, state: "completed" },
			"Add automatic run titles",
		),
	);
	expect(test.create).toHaveBeenCalledOnce();
	expect(test.stop).toHaveBeenCalledOnce();
	expect(test.slots.active).toBe(0);
	expect(existsSync(join(test.directory, "factory", "title-jobs", "run"))).toBe(
		false,
	);
	await test.generator.shutdown();
});
it("falls back to final assistant text, and ignores failed/completed jobs", async () => {
	const test = setup();
	test.generator.start("past", { ...job(), state: "completed" });
	test.generator.start("failed", { ...job(), state: "failed" });
	test.generator.start("new", job());
	await vi.waitFor(() => expect(test.start).toHaveBeenCalledOnce());
	await test.emit({
		type: "assistant",
		message: {
			content: [{ type: "text", text: '{"title":"Name the new task"}' }],
		},
	});
	test.completion.resolve();
	await vi.waitFor(() =>
		expect(test.update).toHaveBeenCalledWith(
			"new",
			expect.objectContaining({ state: "completed" }),
			"Name the new task",
		),
	);
	await test.generator.shutdown();
});
it.each([
	"provider-error",
	"invalid",
])("retains fallback state and stops auxiliary work on %s", async (mode) => {
	const test = setup();
	test.generator.start("run", job());
	await vi.waitFor(() => expect(test.start).toHaveBeenCalledOnce());
	if (mode === "provider-error")
		test.config().onError?.(new Error("No authentication"));
	if (mode === "invalid") {
		await test.emit({ type: "result", result: '{"title":""}' });
		test.completion.resolve();
	}
	await vi.waitFor(() =>
		expect(test.update).toHaveBeenCalledWith(
			"run",
			expect.objectContaining({ state: "failed", error: expect.any(String) }),
		),
	);
	expect(test.stop).toHaveBeenCalledOnce();
	expect(test.slots.active).toBe(0);
	await test.generator.shutdown();
	test.completion.resolve();
});
it("retries a timeout once with a longer deadline and accepts the second result", async () => {
	vi.useFakeTimers();
	const test = setup(100);
	try {
		test.generator.start("run", job());
		await vi.advanceTimersByTimeAsync(100);
		expect(test.start).toHaveBeenCalledTimes(2);
		expect(test.stop).toHaveBeenCalledOnce();
		expect(test.update).toHaveBeenCalledExactlyOnceWith("run", {
			...job(),
			retries: 1,
		});
		await vi.advanceTimersByTimeAsync(150);
		expect(test.slots.active).toBe(1);
		test.emit({ type: "result", result: '{"title":"Name recovered task"}' });
		test.completion.resolve();
		await vi.advanceTimersByTimeAsync(0);
		expect(test.update).toHaveBeenLastCalledWith(
			"run",
			{ ...job(), retries: 1, state: "completed" },
			"Name recovered task",
		);
		expect(test.stop).toHaveBeenCalledTimes(2);
		expect(test.slots.active).toBe(0);
	} finally {
		await test.generator.shutdown();
		vi.useRealTimers();
	}
});
it.each([
	0, 1,
])("bounds timeouts across restarts with %s saved retries", async (retries) => {
	vi.useFakeTimers();
	const test = setup(100);
	try {
		test.generator.start("run", { ...job(), retries });
		await vi.advanceTimersByTimeAsync(300);
		expect(test.start).toHaveBeenCalledTimes(2 - retries);
		expect(test.update).toHaveBeenLastCalledWith("run", {
			...job(),
			retries: 1,
			state: "failed",
			error: "Title generation timed out",
		});
		expect(test.slots.active).toBe(0);
	} finally {
		await test.generator.shutdown();
		test.completion.resolve();
		vi.useRealTimers();
	}
});
it("cancels queued work immediately while primary execution holds the only slot", async () => {
	const slots = new SessionSemaphore(1);
	await slots.acquire();
	const test = setup(1000, slots);
	test.generator.start("run", job());
	expect(slots.waiting).toBe(1);
	test.generator.cancel("run");
	await vi.waitFor(() =>
		expect(test.update).toHaveBeenCalledWith(
			"run",
			expect.objectContaining({ state: "cancelled" }),
		),
	);
	expect(test.start).not.toHaveBeenCalled();
	expect(slots.waiting).toBe(0);
	expect(slots.active).toBe(1);
	slots.release();
	await test.generator.shutdown();
});
it("admits queued primary work before background titles", async () => {
	const slots = new SessionSemaphore(1);
	await slots.acquire();
	const order: string[] = [];
	const background = slots.acquire(undefined, true).then(() => {
		order.push("title");
		slots.release();
	});
	const primary = slots.acquire().then(() => {
		order.push("execution");
		slots.release();
	});
	slots.release();
	await Promise.all([primary, background]);
	expect(order).toEqual(["execution", "title"]);
});
it("shutdown keeps pending snapshots recoverable and ignores a late completion", async () => {
	const test = setup();
	test.generator.start("run", job());
	await vi.waitFor(() => expect(test.start).toHaveBeenCalledOnce());
	await test.generator.shutdown();
	await test.emit({ type: "result", result: '{"title":"Late title"}' });
	test.completion.resolve();
	expect(test.update).not.toHaveBeenCalled();
	expect(test.stop).toHaveBeenCalledOnce();
});
it("does not create a runner when slow configuration resolves after timeout", async () => {
	const directory = home(),
		config = deferred<AgentRunnerConfig>(),
		create = vi.fn(),
		update = vi.fn();
	const slots = new SessionSemaphore(1);
	const generator = new RunTitleGenerator(
		directory,
		slots,
		{ buildConfig: () => config.promise, createRunner: create, update },
		10,
	);
	generator.start("run", { ...job(), retries: 1 });
	await vi.waitFor(() =>
		expect(update).toHaveBeenCalledWith(
			"run",
			expect.objectContaining({ state: "failed" }),
		),
	);
	config.resolve({ workingDirectory: directory });
	await Promise.resolve();
	expect(create).not.toHaveBeenCalled();
	expect(slots.active).toBe(0);
	await generator.shutdown();
});
it("persists global settings independently of recipes and frozen run snapshots", async () => {
	const directory = home(),
		hooks = {
			agent: async () => ({}),
			script: async () => ({}),
			tool: async () => ({}),
			titleDefaults: (
				runner: RunTitleJob["settings"]["runner"] = "claude",
			) => ({ runner, model: `${runner}-global` }),
		};
	const runtime = new WorkflowRuntime(directory, hooks);
	runtime.updateTitleSettings({
		runner: "codex",
		model: "cheap",
		reasoningEffort: "low",
	});
	const workflow = runtime.selectWorkflow([], "manual", "factory");
	const run = runtime.create({
		id: "exact-id",
		title: "Ignored",
		workflow,
		input: "Task",
		repositoryId: "repo",
		workspace: directory,
		runner: "claude",
		model: "expensive",
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
	});
	expect(run.title).toBe("exact-id");
	expect(run.titleGeneration?.settings).toEqual({
		runner: "codex",
		model: "cheap",
		modelReasoningEffort: "low",
	});
	runtime.updateTitleSettings({ runner: "gemini" });
	runtime.updateWorkflows(runtime.listWorkflows());
	expect(run.titleGeneration?.settings.model).toBe("cheap");
	const restored = new WorkflowRuntime(directory, hooks);
	expect(restored.resolveTitleSettings()).toEqual({
		runner: "gemini",
		model: "gemini-global",
	});
	expect(restored.get("exact-id").titleGeneration).toEqual(run.titleGeneration);
	run.status = "completed";
	runtime.updateTitle(
		run.id,
		{ ...run.titleGeneration!, state: "completed" },
		"Useful task name",
	);
	expect(new WorkflowRuntime(directory, hooks).get(run.id).title).toBe(
		"Useful task name",
	);
	expect(() =>
		runtime.updateTitleSettings({ runner: "gemini", serviceTier: "fast" }),
	).toThrow();
	await runtime.shutdown();
	await restored.shutdown();
});
it("migrates mutable title fields, retains frozen definitions, and ignores legacy request titles", () => {
	const directory = home();
	const runtime = new WorkflowRuntime(directory, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	const old = structuredClone(defaultWorkflows);
	old.find((workflow) => workflow.id === "simple")!.launchFields = [
		{
			name: "title",
			label: "Title",
			type: "text",
			required: false,
			options: [],
		},
		{
			name: "prompt",
			label: "Task",
			type: "textarea",
			required: true,
			options: [],
		},
	];
	writeFileSync(
		join(directory, "factory", "workflows.json"),
		JSON.stringify(old),
	);
	const restored = new WorkflowRuntime(directory, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	const workflow = restored.selectWorkflow([], "manual", "simple");
	expect(getLaunchFields(workflow).map((field) => field.name)).toEqual([
		"prompt",
	]);
	expect(() => validateWorkflows(old)).toThrow("Reserved launch field");
	const request = resolveLaunchRequest(
		workflow,
		LaunchRequestSchema.parse({
			repositoryId: "repo",
			workflow: "simple",
			title: "Ignored",
			inputs: { title: "Also ignored", prompt: "Task" },
		}),
	);
	expect(request).toEqual({
		repositoryId: "repo",
		workflow: "simple",
		inputs: { prompt: "Task" },
		prompt: "Task",
		source: undefined,
	});
	expect(
		JSON.parse(
			readFileSync(join(directory, "factory", "workflows.json"), "utf8"),
		).workflows.find((item: { id: string }) => item.id === "simple")
			.launchFields,
	).toHaveLength(1);
	void runtime.shutdown();
	void restored.shutdown();
});

it("keeps primary launches available when inherited title provider settings become incompatible", async () => {
	let runner: RunTitleJob["settings"]["runner"] = "codex";
	const runtime = new WorkflowRuntime(home(), {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
		titleDefaults: () => ({ runner }),
	});
	runtime.updateTitleSettings({ reasoningEffort: "low" });
	runner = "gemini";
	const workflow = runtime.selectWorkflow([], "manual", "simple");
	const run = runtime.create({
		id: "provider-changed",
		workflow,
		input: "Work",
		repositoryId: "repo",
		workspace: home(),
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
	});
	expect(run.title).toBe(run.id);
	expect(run.status).toBe("running");
	expect(run.titleGeneration).toMatchObject({
		state: "failed",
		settings: { runner: "gemini" },
	});
	expect(run.titleGeneration?.error).toMatch(/not supported/);
	await runtime.shutdown();
});
