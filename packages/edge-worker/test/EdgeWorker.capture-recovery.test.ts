import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { captureEvidence } from "../src/factory/FactoryTools.js";
import { roleProgress } from "../src/factory/Incremental.js";
import type { ExecutionContext } from "../src/factory/WorkflowRuntime.js";
import { SessionSemaphore } from "../src/RunnerConcurrency.js";

const directories: string[] = [];
afterEach(() => {
	for (const path of directories.splice(0))
		rmSync(path, { recursive: true, force: true });
});

async function fixture() {
	const workspace = mkdtempSync(join(tmpdir(), "capture-recovery-"));
	directories.push(workspace);
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: workspace, encoding: "utf8" }).trim();
	git("init", "-b", "main");
	git("config", "user.name", "Fixture");
	git("config", "user.email", "fixture@example.test");
	git("config", "commit.gpgsign", "false");
	writeFileSync(join(workspace, "view.txt"), "View");
	writeFileSync(join(workspace, "other.txt"), "Other");
	git("add", ".");
	git("commit", "-m", "chore: initial");
	const evidenceDir = join(workspace, ".git", "evidence");
	mkdirSync(evidenceDir);
	const image = (name: string, byte: number, state = name) => {
		const path = join(evidenceDir, name);
		writeFileSync(path, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, byte]));
		return { path, caption: name, area: "Reader", state };
	};
	const old = [image("paid.png", 1), image("free.png", 2)];
	const ctx = {
		run: {
			id: "capture-run",
			repositoryId: "repo",
			workspace,
			runner: "codex",
			workflow: { id: "fixture" },
			step: "pipeline/capture",
			history: [],
			outputs: {
				"visual-scope": {
					areas: [
						{
							name: "Reader",
							states: old.map((s) => s.state),
							dependencies: ["view.txt"],
							changed: false,
						},
					],
					nonVisualFiles: ["other.txt"],
				},
				"visual-gate": { approved: true },
			},
		},
		step: { id: "capture", name: "Capture", prompt: "Capture screenshots" },
		evidenceDir,
		log: vi.fn(),
		signal: new AbortController().signal,
		checkpointAgent: vi.fn(),
	} as unknown as ExecutionContext;
	ctx.progress = await roleProgress(ctx);
	const accepted = captureEvidence(ctx, { screenshots: old });
	ctx.run.roleRevisions = { "pipeline/capture": ctx.progress.currentRevision! };
	ctx.run.history = [{ step: "pipeline/capture", output: accepted, at: "" }];
	writeFileSync(join(workspace, "other.txt"), "Nonvisual change");
	git("add", ".");
	git("commit", "-m", "fix: nonvisual");
	// The widened dependency inventory cannot prove equality with the accepted one.
	(ctx.run.outputs["visual-scope"] as any).areas[0].dependencies.push(
		"other.txt",
	);
	const fresh = image("web.png", 3);
	const saved = { screenshots: [...old, fresh], unavailable: [] };
	const revision = (await roleProgress(ctx)).currentRevision!;
	ctx.resumeAgent = {
		runner: "codex",
		sessionId: "existing-conversation",
		result: { output: saved, revision },
	};
	const repaired = {
		screenshots: [
			image("paid-new.png", 4, old[0]!.state),
			image("free-new.png", 5, old[1]!.state),
			fresh,
		],
	};
	let config: any;
	let input: any;
	const runner = {
		start: vi.fn(async () => {
			input = JSON.parse(
				readFileSync(config.mcpConfig["factory-context"].args[1], "utf8"),
			);
			config.onMessage({
				type: "system",
				subtype: "init",
				session_id: "existing-conversation",
			});
		}),
		stop: vi.fn(),
		getMessages: () => [{ type: "result", result: JSON.stringify(repaired) }],
	};
	const worker = Object.assign(Object.create(EdgeWorker.prototype), {
		agentSessionManager: { getSession: () => ({}), addAgentRunner: vi.fn() },
		repositories: new Map([["repo", { repositoryPath: workspace }]]),
		cyrusHome: workspace,
		runnerSlots: new SessionSemaphore(1),
		buildAgentRunnerConfig: vi.fn(async () => ({
			runnerType: "codex",
			config: { model: "fixture" },
		})),
		buildAllowedTools: () => [],
		buildDisallowedTools: () => [],
		getDefaultFallbackModelForRunner: () => undefined,
		saveFactorySession: vi.fn(),
		buildRunnerForType: vi.fn((_type, value) => {
			config = value;
			return runner;
		}),
	});
	return {
		ctx,
		saved,
		fresh,
		repaired,
		runner,
		worker,
		getConfig: () => config,
		getInput: () => input,
	};
}

it("resumes a rejected completed capture to replace only invalid evidence", async () => {
	const { ctx, saved, fresh, repaired, runner, worker, getConfig, getInput } =
		await fixture();
	const output = await worker.executeFactoryAgent(ctx);
	expect(runner.start).toHaveBeenCalledOnce();
	expect(getConfig().resumeSessionId).toBe("existing-conversation");
	expect(getInput().captureCorrection).toEqual({
		rejectedOutput: saved,
		screenshots: saved.screenshots
			.slice(0, 2)
			.map(({ path, area, state }) => ({ path, area, state })),
	});
	expect(output).toMatchObject({
		screenshots: repaired.screenshots.map((s) => ({
			path: s.path,
			reused: false,
		})),
	});
	expect((output as any).screenshots[2].path).toBe(fresh.path);
	expect(ctx.checkpointAgent).toHaveBeenNthCalledWith(1, {
		runner: "codex",
		sessionId: "existing-conversation",
		result: ctx.resumeAgent!.result,
	});
	expect(ctx.checkpointAgent).toHaveBeenLastCalledWith(
		expect.objectContaining({
			result: {
				output: repaired,
				revision: expect.objectContaining({
					headSha: ctx.resumeAgent!.result!.revision.headSha,
				}),
			},
		}),
	);
	expect(ctx.resumeAgent!.result!.output).toEqual(saved);
});

it("still revalidates valid saved output without restarting the runner", async () => {
	const { ctx, repaired, runner, worker } = await fixture();
	ctx.resumeAgent!.result!.output = repaired;
	await expect(worker.executeFactoryAgent(ctx)).resolves.toMatchObject({
		screenshots: repaired.screenshots,
	});
	expect(runner.start).not.toHaveBeenCalled();
});

it("keeps filesystem/finalization failures retryable without discarding the saved result", async () => {
	const { ctx, repaired, runner, worker } = await fixture();
	ctx.resumeAgent!.result!.output = repaired;
	rmSync(repaired.screenshots[0]!.path);
	await expect(worker.executeFactoryAgent(ctx)).rejects.toThrow(
		"Screenshot missing",
	);
	expect(runner.start).not.toHaveBeenCalled();
	expect(ctx.resumeAgent!.result!.output).toEqual(repaired);
});
