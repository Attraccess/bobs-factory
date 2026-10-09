import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { FactoryTools } from "../src/factory/FactoryTools.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";

const directories: string[] = [];
afterEach(() =>
	directories.splice(0).forEach((directory) => {
		rmSync(directory, { recursive: true, force: true });
	}),
);
it.each([
	"code",
	"visual",
])("repairs only an incomplete %s review across restart without replaying accepted work", async (role) => {
	const directory = mkdtempSync(join(tmpdir(), "factory-review-outcome-"));
	directories.push(directory);
	const review = `${role}-review`,
		gate = role === "code" ? "review-gate" : "visual-gate";
	const workflow = validateWorkflows([
		...defaultWorkflows,
		{
			id: "review-fixture",
			name: "Review fixture",
			steps: [
				{
					id: review,
					name: review,
					type: "agent",
					prompt: "Review",
					next: gate,
				},
				{
					id: gate,
					name: gate,
					type: "tool",
					tool: gate,
					branches: [
						{ when: { path: "approved", equals: false }, next: "fix" },
					],
					next: "end",
				},
				{
					id: "fix",
					name: "Fix",
					type: "agent",
					prompt: "Never fix missing tools",
					next: review,
				},
			],
		},
	]).at(-1)!;
	const tools = new FactoryTools();
	const runtime = new WorkflowRuntime(directory, {
		agent: async () => ({
			status: "blocked",
			blockers: ["Scoped context connection unavailable"],
			findings: [],
			summary: "No review performed",
		}),
		script: async () => ({}),
		tool: (context) => tools.tool(context),
	});
	const run = runtime.create({
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
		title: "PRIVATE review input",
		repositoryId: "repo",
		workspace: directory,
		workflow,
		input: "Accepted feature",
	});
	run.outputs.implement = {
		status: "completed",
		summary: "Accepted implementation",
	};
	run.outputs.capture = {
		screenshots: [{ path: "accepted.png" }],
		stamp: "accepted evidence",
	};
	const executing = runtime.launch(run);
	await vi.waitFor(() => expect(run.status).toBe("waiting"));
	expect(run.outputs[gate]).toMatchObject({
		approved: false,
		reviewIncomplete: true,
	});
	await runtime.shutdown();
	await executing;
	const retained = structuredClone(run.history);
	const visited: string[] = [];
	const restarted = new WorkflowRuntime(directory, {
		agent: async (context) => {
			visited.push(context.step.id);
			return {
				status: "completed",
				blockers: [],
				findings: [],
				summary: "Repaired inputs and actual clean review",
			};
		},
		script: async () => ({}),
		tool: async (context: ExecutionContext) =>
			role === "visual"
				? {
						approved:
							(context.run.outputs[review] as any).status === "completed",
						findings: [],
					}
				: tools.tool(context),
	});
	restarted.resumeAll();
	await vi.waitFor(() =>
		expect(restarted.runs.get(run.id)?.status).toBe("waiting"),
	);
	restarted.answer(run.id, "Scoped tools repaired; retry review.");
	await vi.waitFor(() =>
		expect(restarted.runs.get(run.id)?.status).toBe("completed"),
	);
	const repaired = restarted.runs.get(run.id)!;
	expect(visited).toEqual([review]);
	expect(repaired.history.slice(0, retained.length)).toEqual(retained);
	expect(repaired.outputs.implement).toEqual(run.outputs.implement);
	expect(repaired.outputs.capture).toEqual(run.outputs.capture);
	await restarted.shutdown();
});
