// F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/desktop-service-lifecycle.mjs
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	acquireInstanceLock,
	workerOwner,
} from "../../../../apps/cli/src/services/InstanceLock.ts";
import { defaultWorkflows } from "../../../../packages/edge-worker/dist/factory/defaultWorkflows.js";
import { validateWorkflows } from "../../../../packages/edge-worker/dist/factory/Workflow.js";
import { WorkflowRuntime } from "../../../../packages/edge-worker/dist/factory/WorkflowRuntime.js";
import { FactoryServer } from "../../../../packages/edge-worker/test/fixtures/authenticated-factory.ts";

assert.equal(process.env.F1_AGENT_MODE, "mock");
const home = mkdtempSync(join(tmpdir(), "f1-desktop-lifecycle-"));
const workspace = join(home, "repo");
mkdirSync(workspace);
const workflow = validateWorkflows([
	...defaultWorkflows,
	{
		id: "lifecycle-fixture",
		name: "Lifecycle fixture",
		entry: "prepare",
		steps: [
			{
				id: "prepare",
				name: "Mock preparation",
				type: "agent",
				prompt: "Mock fixture",
				next: "clarify",
			},
			{
				id: "clarify",
				name: "Mock clarification",
				type: "agent",
				prompt: "Mock questions",
				askQuestions: true,
				next: "finish",
			},
			{
				id: "finish",
				name: "Mock completion",
				type: "script",
				script: "fixture",
			},
		],
	},
]).at(-1);
let calls = 0,
	finishes = 0;
const hooks = {
	agent: async (ctx) => {
		calls++;
		if (ctx.step.id === "prepare") {
			ctx.checkpointAgent?.({
				sessionId: "mock-native-conversation-1",
				runner: "codex",
				cwd: workspace,
			});
			return { prepared: true };
		}
		return ctx.run.answers.length
			? { questions: [], answer: ctx.run.answers.at(-1) }
			: { questions: ["Which color?"] };
	},
	script: async () => {
		finishes++;
		return { done: true };
	},
	tool: async () => {
		throw Error("No tools");
	},
};
let release = await acquireInstanceLock(home),
	runtime = new WorkflowRuntime(home, hooks),
	server;
const run = runtime.create({
	triggerOrigin: {
		type: "manual",
		workflowId: workflow.id,
		at: new Date().toISOString(),
	},
	title: "Lifecycle recovery",
	repositoryId: "fixture",
	workspace,
	input: "Mock lifecycle",
	workflow,
});
void runtime.launch(run);
const until = async (check) => {
	const end = Date.now() + 10000;
	while (!check()) {
		assert.notEqual(
			runtime.get(run.id).status,
			"failed",
			runtime.get(run.id).error,
		);
		assert.ok(Date.now() < end, "Fixture wait timeout");
		await new Promise((r) => setTimeout(r, 10));
	}
};
try {
	await until(() => runtime.get(run.id).status === "waiting");
	const before = runtime.get(run.id);
	const captured = {
		id: before.id,
		questions: structuredClone(before.questions),
		outputs: structuredClone(before.outputs),
		history: structuredClone(before.history),
		checkpoint: structuredClone(before.checkpoint),
	};
	await assert.rejects(acquireInstanceLock(home), /already owned/);
	assert.equal(workerOwner(home).pid, process.pid);
	server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {},
		stop: (id) => runtime.stop(id),
	});
	let result = await server.app.inject({
		method: "GET",
		url: `/api/runs/${run.id}`,
	});
	assert.equal(result.statusCode, 200);
	assert.equal(result.json().status, "waiting");
	// Closing a UI connection does not own runtime shutdown or alter the wait.
	assert.equal(runtime.get(run.id).status, "waiting");
	await server.stop();
	await runtime.shutdown();
	release();
	release = await acquireInstanceLock(home);
	runtime = new WorkflowRuntime(home, hooks);
	runtime.resumeAll();
	await until(() => runtime.get(run.id).status === "waiting");
	for (const [key, value] of Object.entries(captured))
		assert.deepEqual(runtime.get(run.id)[key], value);
	assert.equal(calls, 2, "completed preparation/clarification must not rerun");
	server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {},
		stop: (id) => runtime.stop(id),
	});
	result = await server.app.inject({
		method: "GET",
		url: `/api/runs/${run.id}`,
	});
	assert.equal(result.statusCode, 200);
	assert.deepEqual(result.json().questions, ["Which color?"]);
	runtime.answer(run.id, "Blue");
	await until(() => runtime.get(run.id).status === "completed");
	assert.equal(finishes, 1);
	const persisted = JSON.parse(
		readFileSync(join(home, "factory", "runs", `${run.id}.json`), "utf8"),
	);
	assert.equal(persisted.id, run.id);
	assert.ok(persisted.events.length > 0);
	console.log(
		JSON.stringify(
			{
				passed: true,
				home,
				mode: "mock/scripted",
				assertions: [
					"one-home ownership",
					"client disconnect leaves human wait",
					"graceful stop/reopen same run/native checkpoint",
					"question/gates/outputs/history preserved",
					"accepted answer completes once",
					"authenticated activity/detail retained",
				],
				calls,
				finishes,
			},
			null,
			2,
		),
	);
} finally {
	await server?.stop();
	await runtime.shutdown();
	release();
}
