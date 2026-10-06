import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import * as tools from "../src/factory/FactoryTools.js";
import type { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";

const directories: string[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

function fixture() {
	const home = mkdtempSync(join(tmpdir(), "merge-recovery-"));
	directories.push(home);
	const worker = new EdgeWorker({
		platform: "cli",
		cyrusHome: home,
		repositories: [
			{
				id: "repo",
				name: "Repo",
				repositoryPath: home,
				workspaceBaseDir: home,
				baseBranch: "main",
				isActive: true,
			},
		],
	});
	const runtime: WorkflowRuntime = (worker as any).getFactoryRuntime();
	const workflow = defaultWorkflows.find((item) => item.id === "factory")!;
	const run = runtime.create({
		id: "recover-merge",
		repositoryId: "repo",
		workflow,
		workspace: join(home, "deleted-worktree"),
		input: "Task",
		triggerOrigin: {
			type: "manual",
			workflowId: "factory",
			at: "2026-10-06T00:00:00Z",
		},
	});
	run.titleGeneration = undefined;
	run.status = "failed";
	run.step = "pipeline/merge";
	run.outputs["draft-pr"] = { url: "https://github.com/test/repo/pull/1" };
	run.history = [
		{ step: "pipeline/guide", output: { summary: "Retained guide" }, at: "" },
	];
	run.humanDecisions = [
		{ reviewId: "gate", decision: "approve", headSha: "approved", at: "" },
	];
	run.checkpoint = {
		current: "pipeline",
		visits: { pipeline: 1 },
		active: {
			phase: "executing",
			children: [
				{
					current: "merge",
					visits: { merge: 1 },
					active: { phase: "executing" },
				},
			],
		},
	};
	return { runtime, run, home };
}

it.each([
	["MERGED", "approved", "completed"],
	["MERGED", "another-revision", "failed"],
	["OPEN", "approved", "failed"],
	["CLOSED", "approved", "failed"],
])("recovers the saved merge checkpoint only for the approved merged revision (%s/%s)", async (state, headRefOid, status) => {
	const { runtime, run, home } = fixture();
	const history = structuredClone(run.history);
	const command = vi
		.spyOn(tools, "executeCommand")
		.mockImplementation(async (ctx, exe, args) => {
			expect(ctx.run.workspace).toBe(home);
			expect(exe).toBe("gh");
			expect(args).toEqual([
				"pr",
				"view",
				"https://github.com/test/repo/pull/1",
				"--json",
				"state,headRefOid",
			]);
			return JSON.stringify({ state, headRefOid });
		});
	run.status = "running";
	await runtime.launch(run);
	expect(command).toHaveBeenCalledOnce();
	expect(run.status).toBe(status);
	expect(run.history.slice(0, history.length)).toEqual(history);
	if (status === "completed") {
		expect(run.outputs.merge).toEqual({
			merged: true,
			url: "https://github.com/test/repo/pull/1",
			headSha: "approved",
		});
		expect(run.checkpoint!.current).toBe("end");
		expect(runtime.viewState(run.id).settledAt).toBeDefined();
		expect(run.history.slice(history.length).map((item) => item.step)).toEqual([
			"pipeline/merge",
			"pipeline",
		]);
	} else {
		expect(run.outputs.merge).toBeUndefined();
		expect(run.history).toEqual(history);
		expect(run.error).toMatch(
			/worktree is unavailable|explicitly approved revision/,
		);
	}
	await runtime.shutdown();
});

it("retains an already saved merge receipt without duplicating it", async () => {
	const { runtime, run } = fixture();
	const output = {
		merged: true,
		url: "https://github.com/test/repo/pull/1",
		headSha: "approved",
	};
	run.outputs.merge = output;
	run.history.push({ step: "pipeline/merge", output, at: "" });
	run.checkpoint!.active!.children![0]!.active!.phase = "result";
	vi.spyOn(tools, "executeCommand").mockResolvedValue(
		JSON.stringify({ state: "MERGED", headRefOid: "approved" }),
	);
	await runtime.launch(run);
	expect(run.status).toBe("completed");
	expect(
		run.history.filter((item) => item.step === "pipeline/merge"),
	).toHaveLength(1);
	await runtime.shutdown();
});

it.each([
	"no-approval",
	"unfinished-agent",
	"more-work",
])("does not bypass missing-worktree protection for %s", async (scenario) => {
	const { runtime, run } = fixture();
	if (scenario === "no-approval") run.humanDecisions = [];
	if (scenario === "unfinished-agent") {
		run.step = "pipeline/guide";
		run.checkpoint!.active!.children![0]!.current = "guide";
	}
	if (scenario === "more-work") run.workflow.steps[0]!.next = "pipeline";
	const command = vi.spyOn(tools, "executeCommand");
	await runtime.launch(run);
	expect(command).not.toHaveBeenCalled();
	expect(run.status).toBe("failed");
	expect(run.error).toContain("Saved worktree is unavailable");
	await runtime.shutdown();
});
