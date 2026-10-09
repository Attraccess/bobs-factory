// F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/factory-delivery-fanout.mjs
// Focused authenticated Factory API replay. Agent and provider/tool boundaries are scripted.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultWorkflows } from "../../../../packages/edge-worker/dist/factory/defaultWorkflows.js";
import { validateWorkflows } from "../../../../packages/edge-worker/dist/factory/Workflow.js";
import { WorkflowRuntime } from "../../../../packages/edge-worker/dist/factory/WorkflowRuntime.js";
import { FactoryServer } from "../../../../packages/edge-worker/test/fixtures/authenticated-factory.ts";

assert.equal(
	process.env.F1_AGENT_MODE,
	"mock",
	"This fixture never invokes a paid runner",
);
const evidence = [];
for (const boundary of ["direct", "called"]) {
	const home = mkdtempSync(join(tmpdir(), "f1-delivery-fanout-"));
	const roles = [],
		providerCalls = [],
		launches = [];
	let release;
	const firstProvider = new Promise((resolve) => {
		release = resolve;
	});
	const runtime = new WorkflowRuntime(home, {
		agent: async ({ run, step }) => {
			roles.push(`${run.input}:${step.id}`);
			return {};
		},
		script: async () => ({}),
		tool: async ({ run, step }) => {
			providerCalls.push(`${run.input}:${step.tool}`);
			if (run.input === "first" && step.tool === "draft-pr")
				await firstProvider;
			return {};
		},
	});
	const workflows = validateWorkflows([
		...defaultWorkflows,
		{
			id: "publication-child",
			name: "Publication child",
			steps: [
				{ id: "publish", name: "Publish", type: "tool", tool: "draft-pr" },
			],
		},
		{
			id: "fanout-delivery",
			name: "Fanout delivery",
			steps: [
				{
					id: "implementation",
					name: "Implementation",
					type: "fanout",
					groups: [
						[
							{
								id: "code",
								name: "Code",
								type: "agent",
								prompt: "Scripted code receipt",
							},
						],
						[
							{
								id: "test",
								name: "Test",
								type: "agent",
								prompt: "Scripted test receipt",
							},
						],
					],
				},
				{
					id: "publication",
					name: "Publication",
					type: "fanout",
					groups: [
						[
							boundary === "direct"
								? {
										id: "publish",
										name: "Publish",
										type: "tool",
										tool: "draft-pr",
									}
								: {
										id: "publish",
										name: "Publish",
										type: "workflow",
										workflow: "publication-child",
									},
						],
					],
				},
				{ id: "finish", name: "Finish", type: "tool", tool: "handoff" },
			],
		},
	]);
	runtime.updateWorkflows(workflows);
	const server = new FactoryServer(runtime, {
		repositories: () => [{ id: "fixture", name: "Fixture" }],
		sessions: () => [],
		entries: () => [],
		stop: (id) => runtime.stop(id),
		start: async (input) => {
			const workflow = runtime.selectWorkflow([], "manual", input.workflow);
			const run = runtime.create({
				repositoryId: input.repositoryId,
				workflow,
				workspace: home,
				input: input.prompt,
				triggerOrigin: {
					type: "manual",
					workflowId: workflow.id,
					at: new Date().toISOString(),
				},
			});
			run.outputs.repository = {
				githubUrl: "https://github.com/f1/fanout-fixture",
				baseBranch: "main",
			};
			launches.push(runtime.launch(run));
			return run;
		},
	});
	const api = async (method, url, payload) => {
		const result = await server.app.inject({
			method,
			url,
			payload,
			headers: { "x-factory-request": "1" },
		});
		assert.ok(
			result.statusCode < 300,
			`${method} ${url}: ${result.statusCode} ${result.body}`,
		);
		return result.json();
	};
	const start = (prompt) =>
		api("POST", "/api/runs", {
			repositoryId: "fixture",
			workflow: "fanout-delivery",
			prompt,
		});
	const get = (run) => api("GET", `/api/runs/${run.id}`);
	const until = async (run, predicate) => {
		const deadline = Date.now() + 5000;
		for (;;) {
			const state = await get(run);
			assert.notEqual(state.status, "failed", state.error);
			if (predicate(state)) return state;
			assert.ok(
				Date.now() < deadline,
				`${boundary}: timed out at ${state.step} (${state.status})`,
			);
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
	};
	try {
		const first = await start("first");
		await until(first, () => providerCalls.includes("first:draft-pr"));
		const second = await start("second");
		const queued = await until(
			second,
			(state) => state.deliveryCoordination?.phase === "queued",
		);
		assert.deepEqual(roles, [
			"first:code",
			"first:test",
			"second:code",
			"second:test",
		]);
		assert.deepEqual(providerCalls, ["first:draft-pr"]);
		release();
		const completed = await Promise.all([
			until(first, (state) => state.status === "completed"),
			until(second, (state) => state.status === "completed"),
		]);
		assert.deepEqual(providerCalls, [
			"first:draft-pr",
			"first:handoff",
			"second:draft-pr",
			"second:handoff",
		]);
		evidence.push({
			boundary,
			roles,
			providerCalls,
			queued: { id: queued.id, coordination: queued.deliveryCoordination },
			completed: completed.map((run) => ({
				id: run.id,
				status: run.status,
				coordination: run.deliveryCoordination,
				history: run.history,
			})),
		});
	} finally {
		release();
		await Promise.allSettled(launches);
		await runtime.shutdown();
		await server.stop();
		rmSync(home, { recursive: true, force: true });
	}
}
const destination =
	process.env.F1_EVIDENCE_DIR ??
	mkdtempSync(join(tmpdir(), "f1-delivery-fanout-evidence-"));
mkdirSync(destination, { recursive: true });
const artifact = join(destination, "factory-delivery-fanout.json");
writeFileSync(
	artifact,
	`${JSON.stringify({ mode: "mock", scenarios: evidence, limitations: ["Agent and provider/tool hooks are controlled. This replay validates authenticated API admission and actual saved workflow execution, not forge mutations or model review."] }, null, 2)}\n`,
);
console.log(
	JSON.stringify({
		result: "PASS",
		mode: "mock",
		scenarios: evidence.length,
		roleVisits: 8,
		providerCalls: 8,
		paidCalls: 0,
		ports: "none",
		artifact,
	}),
);
