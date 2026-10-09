import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";

it.each([
	[{ status: "blocked", findings: [] }, "blocked"],
	[{ status: "failed", findings: [] }, "failed"],
	[
		{ status: "completed", findings: [{ id: "bug", status: "open" }] },
		"completed",
	],
])("records the actual reviewer outcome %j", async (result, outcome) => {
	const home = mkdtempSync(join(tmpdir(), "factory-review-outcome-"));
	const runtime = new WorkflowRuntime(home, {
		agent: async () => result,
		script: async () => ({}),
		tool: async () => ({}),
	});
	const workflow = WorkflowSchema.parse({
		id: "review",
		name: "Review",
		steps: [
			{ id: "code-review", name: "Review", type: "agent", prompt: "Review" },
		],
	});
	const run = runtime.create({
		repositoryId: "fixture",
		workspace: home,
		input: "Review",
		workflow,
		triggerOrigin: { type: "manual", workflowId: workflow.id, at: "" },
	});
	try {
		await runtime.launch(run);
		expect(run.stepAttempts?.map((attempt) => attempt.outcome)).toEqual([
			outcome,
		]);
	} finally {
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});

it("records missing native startup infrastructure as blocked without fabricating a session", async () => {
	const home = mkdtempSync(join(tmpdir(), "factory-infrastructure-outcome-"));
	const runtime = new WorkflowRuntime(home, {
		agent: async (context) => {
			context.checkpointAgent({
				runner: "codex",
				infrastructureFailure: {
					reason: "Required native MCP tool unavailable",
					at: new Date().toISOString(),
				},
			});
			throw new Error("Required native MCP tool unavailable");
		},
		script: async () => ({}),
		tool: async () => ({}),
	});
	const workflow = WorkflowSchema.parse({
		id: "startup",
		name: "Startup",
		steps: [{ id: "guide", name: "Guide", type: "agent", prompt: "Guide" }],
	});
	const run = runtime.create({
		repositoryId: "fixture",
		workspace: home,
		input: "Guide",
		workflow,
		triggerOrigin: { type: "manual", workflowId: workflow.id, at: "" },
	});
	try {
		await runtime.launch(run);
		expect(run.stepAttempts?.map((attempt) => attempt.outcome)).toEqual([
			"blocked",
		]);
		expect(run.checkpoint?.active?.agent?.sessionId).toBeUndefined();
	} finally {
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});
