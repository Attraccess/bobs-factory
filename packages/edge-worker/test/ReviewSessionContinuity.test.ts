import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { FactoryTools } from "../src/factory/FactoryTools.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";

it.each([
	"checkpoint",
	"historical-init",
])("resumes only the blocked reviewer's native session after gate assistance and restart (%s)", async (storage) => {
	const home = mkdtempSync(join(tmpdir(), "review-session-continuity-"));
	const visits: { step: string; session?: string }[] = [];
	const tools = new FactoryTools({ postComment: async () => {} });
	let runtime: WorkflowRuntime;
	const hooks = {
		agent: async (
			context: import("../src/factory/WorkflowRuntime.js").ExecutionContext,
		) => {
			visits.push({
				step: context.step.id,
				session: context.resumeAgent?.sessionId,
			});
			if (context.step.id === "code-review") {
				context.checkpointAgent({
					runner: "codex",
					sessionId: "review-native-session",
					result: {
						output: { status: "blocked", summary: "OLD BLOCKED RESULT" },
						revision: {
							headSha: "fixture-head",
							dirty: false,
							at: new Date().toISOString(),
							historyLength: 0,
						},
					},
				});
				context.log(
					JSON.stringify({
						type: "system",
						subtype: "init",
						session_id: "review-native-session",
					}),
				);
				return {
					status: context.run.answers.length ? "completed" : "blocked",
					blockers: context.run.answers.length
						? []
						: ["Missing required review input"],
					findings: [],
					summary: "Scripted reviewer",
				};
			}
			return {};
		},
		script: async () => ({}),
		tool: (
			context: import("../src/factory/WorkflowRuntime.js").ExecutionContext,
		) => tools.tool(context),
	};
	const workflow = WorkflowSchema.parse({
		id: "repair",
		name: "Repair review",
		steps: [
			{ id: "capture", name: "Capture", type: "agent", prompt: "Capture" },
			{
				id: "code-review",
				name: "Review",
				type: "agent",
				runner: "codex",
				prompt: "Review",
			},
			{
				id: "review-gate",
				name: "Gate",
				type: "tool",
				tool: "review-gate",
				next: "end",
			},
		],
	});
	runtime = new WorkflowRuntime(home, hooks);
	const run = runtime.create({
		repositoryId: "fixture",
		workspace: home,
		input: "Review",
		workflow,
		triggerOrigin: { type: "manual", workflowId: workflow.id, at: "" },
	});
	try {
		void runtime.launch(run);
		await vi.waitFor(() =>
			expect(runtime.pendingAnswers.has(run.id)).toBe(true),
		);
		if (storage === "historical-init") {
			delete run.checkpoint!.agentSessions;
			runtime.save(run);
		}
		await runtime.shutdown();
		runtime = new WorkflowRuntime(home, hooks);
		runtime.resumeAll();
		await vi.waitFor(() =>
			expect(runtime.pendingAnswers.has(run.id)).toBe(true),
		);
		runtime.answer(run.id, "Required review input restored");
		await vi.waitFor(() =>
			expect(runtime.get(run.id).status).toBe("completed"),
		);
		expect(visits).toEqual([
			{ step: "capture", session: undefined },
			{ step: "code-review", session: undefined },
			{ step: "code-review", session: "review-native-session" },
		]);
	} finally {
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});
