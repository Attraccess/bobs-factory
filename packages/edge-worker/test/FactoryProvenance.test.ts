import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { factoryRuntimeIdentity } from "bobs-factory-core";
import { expect, it, vi } from "vitest";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import { FactoryServer } from "./fixtures/authenticated-factory.js";

it("closes crashed native turns when restoring their graph attempt, retaining unrelated and completed receipts", async () => {
	const home = mkdtempSync(join(tmpdir(), "factory-provenance-crash-"));
	const sessions: (string | undefined)[] = [];
	const hooks = {
		agent: async (
			context: import("../src/factory/WorkflowRuntime.js").ExecutionContext,
		) => {
			sessions.push(context.resumeAgent?.sessionId);
			return {};
		},
		script: async () => ({}),
		tool: async () => ({}),
	};
	const original = new WorkflowRuntime(home, hooks);
	let restored: WorkflowRuntime | undefined;
	try {
		const workflow = WorkflowSchema.parse({
			id: "crash",
			name: "Crash recovery",
			steps: [{ id: "work", name: "Work", type: "agent", prompt: "Work" }],
		});
		const run = original.create({
			repositoryId: "fixture",
			workspace: home,
			input: "Task",
			workflow,
			triggerOrigin: { type: "manual", workflowId: workflow.id, at: "" },
		});
		await original.launch(run);
		const parent = run.stepAttempts![0]!;
		// Reproduce the persisted shape after a process disappears during native
		// execution, without its finally handlers recording an outcome.
		parent.outcome = "running";
		delete parent.endedAt;
		const finished = {
			...structuredClone(parent),
			id: "finished-turn",
			parentAttemptId: parent.id,
			kind: "agent-turn" as const,
			outcome: "completed" as const,
			endedAt: "2026-10-08T20:00:00.000Z",
		};
		const crashed = {
			...structuredClone(parent),
			id: "crashed-turn",
			parentAttemptId: parent.id,
			kind: "agent-turn" as const,
		};
		const unrelated = {
			...structuredClone(parent),
			id: "another-live-turn",
			parentAttemptId: "another-live-step",
			kind: "agent-turn" as const,
		};
		run.stepAttempts!.push(finished, crashed, unrelated);
		run.checkpoint = {
			current: "work",
			visits: { work: 1 },
			active: {
				phase: "executing",
				attemptId: parent.id,
				agent: { runner: "codex", sessionId: "retained-native-session" },
			},
		};
		run.status = "interrupted";
		original.save(run);
		await original.shutdown();
		restored = new WorkflowRuntime(home, hooks);
		const saved = restored.get(run.id);
		await restored.launch(saved);
		expect(saved.status).toBe("completed");
		expect(sessions).toEqual([undefined, "retained-native-session"]);
		const receipt = (id: string) =>
			saved.stepAttempts!.find((attempt) => attempt.id === id)!;
		expect(receipt(parent.id).outcome).toBe("interrupted");
		expect(receipt(crashed.id)).toMatchObject({
			outcome: "interrupted",
			endedAt: expect.any(String),
		});
		expect(receipt(finished.id)).toEqual(finished);
		expect(receipt(unrelated.id)).toEqual(unrelated);
	} finally {
		await restored?.shutdown();
		await original.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});

it("preserves an older build receipt while a frozen run resumes on the current runtime and contract", async () => {
	const home = mkdtempSync(join(tmpdir(), "factory-provenance-upgrade-"));
	const hooks = {
		agent: async ({
			step,
			run,
		}: import("../src/factory/WorkflowRuntime.js").ExecutionContext) =>
			step.id === "pause"
				? {
						questions: run.answers.length
							? []
							: ["Continue the accepted task?"],
					}
				: {},
		script: async () => ({}),
		tool: async () => ({}),
	};
	const workflow = WorkflowSchema.parse({
		id: "frozen",
		name: "Frozen",
		steps: [
			{
				id: "first",
				name: "First",
				type: "agent",
				prompt: "Accepted instructions",
				next: "pause",
			},
			{
				id: "pause",
				name: "Pause",
				type: "agent",
				prompt: "Ask",
				askQuestions: true,
				next: "last",
			},
			{
				id: "last",
				name: "Last",
				type: "agent",
				prompt: "Finish accepted work",
			},
		],
	});
	const original = new WorkflowRuntime(home, hooks);
	let restored: WorkflowRuntime | undefined;
	try {
		const run = original.create({
			repositoryId: "fixture",
			workspace: home,
			input: "Task",
			workflow,
			triggerOrigin: {
				type: "manual",
				workflowId: workflow.id,
				at: new Date().toISOString(),
			},
		});
		const execution = original.launch(run);
		await vi.waitFor(() => expect(run.status).toBe("waiting"));
		// Model a verified receipt persisted by an older executable, rather than infer its identity from today's checkout.
		const old = run.stepAttempts![0]!;
		old.runtime = {
			...old.runtime,
			commit: "a".repeat(40),
			dirty: false,
			target: "darwin-arm64",
			packaged: true,
		};
		old.contract = {
			...old.contract,
			validator: "factory-results-v2",
			version: 1,
			hash: "b".repeat(64),
		};
		const retained = structuredClone(old);
		run.contractVersion = 1;
		original.save(run);
		await original.shutdown();
		await execution;
		restored = new WorkflowRuntime(home, hooks);
		const saved = restored.get(run.id);
		const recovery = restored.launch(saved);
		await vi.waitFor(() => expect(saved.status).toBe("waiting"));
		restored.answer(
			saved.id,
			"Continue with the accepted instructions",
			"answer",
		);
		await recovery;
		expect(saved.status).toBe("completed");
		expect(saved.workflow).toEqual(workflow);
		expect(saved.stepAttempts![0]).toEqual(retained);
		const current = saved.stepAttempts!.at(-1)!;
		expect(current.runtime).toEqual(factoryRuntimeIdentity);
		expect(current.workflowHash).toBe(retained.workflowHash);
		expect(current.contract).toMatchObject({
			validator: "factory-results-v4",
			version: 2,
		});
		expect(current.contract.hash).not.toBe(retained.contract.hash);
	} finally {
		await restored?.shutdown();
		await original.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});

it("reports an honest unknown source identity for a development runtime separately from the UI build", async () => {
	const home = mkdtempSync(join(tmpdir(), "factory-provenance-"));
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {
			throw new Error("Unused");
		},
		stop: (id) => runtime.stop(id),
	});
	try {
		const response = await server.app.inject({ url: "/api/version" });
		expect(response.statusCode).toBe(200);
		expect(response.json().runtime).toMatchObject({
			version: factoryRuntimeIdentity.version,
			commit: null,
			dirty: null,
			target: null,
			packaged: false,
		});
		expect(typeof response.json().build).toBe("string");
	} finally {
		await runtime.shutdown();
		await server.stop();
		rmSync(home, { recursive: true, force: true });
	}
});

it("distinguishes a repeated role after human direction from an ordinary workflow visit", async () => {
	const home = mkdtempSync(join(tmpdir(), "factory-provenance-reason-"));
	let calls = 0;
	const runtime = new WorkflowRuntime(home, {
		agent: async (context) => {
			if (++calls === 1)
				runtime.recordChatMessage(context.run.id, "PRIVATE DIRECTION", "work");
			return { again: calls === 1 };
		},
		script: async () => ({}),
		tool: async () => ({}),
	});
	const workflow = WorkflowSchema.parse({
		id: "reasons",
		name: "Reasons",
		steps: [
			{
				id: "work",
				name: "Work",
				type: "agent",
				prompt: "Work",
				branches: [{ when: { path: "again", equals: true }, next: "work" }],
				next: "end",
			},
		],
	});
	const run = runtime.create({
		title: "Reasons",
		repositoryId: "fixture",
		workspace: home,
		input: "Task",
		workflow,
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
	});
	try {
		await runtime.launch(run);
		expect(run.stepAttempts?.map((attempt) => attempt.reason)).toEqual([
			"initial",
			"human-direction",
		]);
		expect(JSON.stringify(run.stepAttempts)).not.toContain("PRIVATE");
	} finally {
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});

it("exports provenance without private task/output content and marks historical records unknown", async () => {
	const home = mkdtempSync(join(tmpdir(), "factory-provenance-export-"));
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({ token: "PRIVATE RESULT" }),
		script: async () => ({}),
		tool: async () => ({}),
	});
	const workflow = WorkflowSchema.parse({
		id: "export",
		name: "Export",
		steps: [
			{
				id: "work",
				name: "Work",
				type: "agent",
				prompt: "PRIVATE INSTRUCTIONS",
			},
		],
	});
	const run = runtime.create({
		title: "PRIVATE TITLE",
		repositoryId: "fixture",
		workspace: home,
		input: "PRIVATE INPUT",
		workflow,
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
	});
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		deliveryStatus: () => [
			{
				platform: "linear",
				workspaceId: "workspace",
				pending: 2,
				delivered: 3,
				superseded: 1,
				hasError: true,
				nextAttemptAt: 123456,
			},
		],
		start: async () => {
			throw new Error("Unused");
		},
		stop: (id) => runtime.stop(id),
	});
	try {
		const unknown = await server.app.inject({
			url: `/api/runs/${run.id}/provenance`,
		});
		expect(unknown.statusCode).toBe(200);
		expect(unknown.json()).toMatchObject({
			legacyProvenance: true,
			attempts: [],
			knownSource: null,
		});
		const delivery = await server.app.inject({ url: "/api/delivery-status" });
		expect(delivery.statusCode).toBe(200);
		expect(delivery.json()).toEqual({
			workspaces: [
				{
					platform: "linear",
					workspaceId: "workspace",
					pending: 2,
					delivered: 3,
					superseded: 1,
					hasError: true,
					nextAttemptAt: 123456,
				},
			],
		});
		await runtime.launch(run);
		Object.assign(run.stepAttempts![0]!, {
			credentials: "PRIVATE LEGACY FIELD",
		});
		const response = await server.app.inject({
			url: `/api/runs/${run.id}/provenance`,
		});
		expect(response.statusCode).toBe(200);
		expect(response.json().attempts).toHaveLength(1);
		expect(response.body).not.toContain("PRIVATE");
		expect(
			(await server.app.inject({ url: "/api/runs/missing/provenance" }))
				.statusCode,
		).toBe(404);
	} finally {
		await runtime.shutdown();
		await server.stop();
		rmSync(home, { recursive: true, force: true });
	}
});

it("retains secret-safe per-step provenance across restart without inventing old attempts", async () => {
	const home = mkdtempSync(join(tmpdir(), "factory-attempt-provenance-"));
	const hooks = {
		agent: async () => ({ summary: "PRIVATE RESULT" }),
		script: async () => ({}),
		tool: async () => ({}),
	};
	const runtime = new WorkflowRuntime(home, hooks);
	const workflow = WorkflowSchema.parse({
		id: "provenance",
		name: "Provenance",
		steps: [
			{
				id: "work",
				name: "Work",
				type: "agent",
				prompt: "PRIVATE INSTRUCTIONS",
			},
		],
	});
	const run = runtime.create({
		title: "Private task",
		repositoryId: "fixture",
		workspace: home,
		input: "PRIVATE INPUT",
		workflow,
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
	});
	try {
		await runtime.launch(run);
		const attempts = runtime.get(run.id).stepAttempts;
		expect(attempts).toHaveLength(1);
		expect(attempts[0]).toMatchObject({
			step: "work",
			type: "agent",
			outcome: "completed",
			reason: "initial",
			runtime: { commit: null, packaged: false },
			contract: { validator: "factory-results-v4" },
		});
		expect(attempts[0].workflowHash).toMatch(/^[a-f0-9]{64}$/);
		expect(attempts[0].instructionsHash).toMatch(/^[a-f0-9]{64}$/);
		expect(JSON.stringify(attempts)).not.toContain("PRIVATE");
		await runtime.shutdown();
		const restored = new WorkflowRuntime(home, hooks);
		expect(restored.get(run.id).stepAttempts).toEqual(attempts);
		await restored.shutdown();
	} finally {
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});
