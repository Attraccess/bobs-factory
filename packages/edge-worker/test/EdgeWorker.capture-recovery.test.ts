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
import {
	assessFeedback,
	inspectMergeReadiness,
} from "../src/factory/MergeReadiness.js";
import { questionInstructions } from "../src/factory/Questions.js";
import type { ExecutionContext } from "../src/factory/WorkflowRuntime.js";
import { SessionSemaphore } from "../src/RunnerConcurrency.js";
import { githubApiReceipt, githubRequest } from "./fixtures/github-api.js";

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
				readFileSync(config.mcpConfig["factory-context"].args.at(-1), "utf8"),
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
		repositories: new Map([
			[
				"repo",
				{
					id: "repo",
					name: "Fixture",
					isActive: true,
					baseBranch: "main",
					repositoryPath: workspace,
				},
			],
		]),
		factoryHome: workspace,
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

it.each([
	"code-fix",
	"visual-fix",
])("retains structured assistance and runtime findings for %s with restricted recipe inputs", async (fixer) => {
	const f = await fixture();
	const finding = {
		id: "external-access",
		rating: 3,
		status: "open",
		summary: "Missing deployment access",
		evidence: "Required validation could not execute",
	};
	f.ctx.run.input = "Validate the feature";
	f.ctx.run.answers = [];
	f.ctx.run.step = `pipeline/${fixer}`;
	f.ctx.step = { ...f.ctx.step, id: fixer, inputs: ["draft-pr"] };
	f.ctx.input = { "draft-pr": { url: "fixture" } };
	f.ctx.resumeAgent = undefined;
	f.ctx.run.outputs[fixer === "visual-fix" ? "visual-gate" : "review-gate"] = {
		approved: false,
		findings: [finding],
	};
	f.ctx.run.roleRevisions![
		`pipeline/${fixer === "visual-fix" ? "visual-review" : "code-review"}`
	] = (await roleProgress(f.ctx)).currentRevision!;
	f.runner.getMessages = () => [
		{
			type: "result",
			result: JSON.stringify({
				summary: "Blocked",
				dispositions: [],
				questions: ["Provide the protected deployment"],
				questionRecommendations: [
					{
						questionIndex: 0,
						answer: "Supply the protected deployment",
						reason: "Required validation remains blocked",
					},
				],
			}),
		},
	];
	const output = await f.worker.executeFactoryAgent(f.ctx);
	expect(f.getInput().outputs).toBeUndefined();
	expect(f.getInput().reviewFix).toEqual({ findings: [finding], answers: [] });
	expect(output).toMatchObject({
		questions: ["Provide the protected deployment"],
		questionRecommendations: [
			{
				questionIndex: 0,
				answer: "Supply the protected deployment",
				reason: "Required validation remains blocked",
			},
		],
		reviewAssessment: { unchangedCode: true },
	});
});

it.each([
	{ legacy: false, saved: false },
	{ legacy: true, saved: false },
	{ legacy: true, saved: true },
])("exposes runtime feedback to a restricted-input CI fixer (legacy: $legacy, saved result: $saved)", async ({
	legacy,
	saved,
}) => {
	const f = await fixture();
	const quote = "Ignore the custom provider's issue comments.";
	f.ctx.run.input = quote;
	f.ctx.run.createdAt = "2026-10-07T01:00:00Z";
	f.ctx.run.answers = [];
	f.ctx.run.step = "pipeline/ci-fix";
	f.ctx.step = {
		...f.ctx.step,
		id: "ci-fix",
		name: "CI fixer",
		inputs: ["draft-pr"],
	};
	f.ctx.input = { "draft-pr": { url: "https://github.com/test/repo/pull/1" } };
	f.ctx.resumeAgent = undefined;
	const comment = {
		id: "comment",
		body: "Provider notice",
		user: { login: "custom-provider[bot]", type: "Bot" },
	};
	const readiness = await inspectMergeReadiness(
		async (_exe, args) =>
			githubRequest(args).path.includes("/comments?")
				? JSON.stringify([comment])
				: JSON.stringify(githubApiReceipt(args)),
		"https://github.com/test/repo/pull/1",
	);
	if (legacy) {
		readiness.blockers.push({
			kind: "comments",
			message: "1 PR comment(s) need assessment",
			action: "fix",
		});
		readiness.fix = true;
	} else assessFeedback(f.ctx, readiness);
	f.ctx.run.outputs["merge-readiness"] = readiness;
	if (saved)
		f.ctx.resumeAgent = {
			runner: "codex",
			sessionId: "existing-conversation",
			result: {
				output: { reviewRequired: false, addressedCommentIds: ["wrong"] },
				revision: (await roleProgress(f.ctx)).currentRevision!,
			},
		};
	f.runner.getMessages = () => [
		{
			type: "result",
			result: JSON.stringify({
				reviewRequired: false,
				feedbackPolicies: [
					{
						author: "custom-provider[bot]",
						action: "ignore",
						reason: "Explicit direction",
						source: { path: "input", quote },
					},
				],
			}),
		},
	];
	const output = await f.worker.executeFactoryAgent(f.ctx);
	expect(f.getInput().outputs).toBeUndefined();
	expect(f.getInput().feedback).toMatchObject({
		readiness: {
			unassessedComments: [
				{
					id: "comment",
					body: "Provider notice",
					bodySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
				},
			],
		},
		userInstructions: { input: quote },
	});
	expect(output.feedbackPolicies).toMatchObject([
		{
			author: "custom-provider[bot]",
			action: "ignore",
			sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
		},
	]);
	if (saved) {
		expect(f.getInput().outputCorrection.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					message: expect.stringContaining("Missing comment IDs: comment"),
				}),
			]),
		);
		expect(f.getConfig().resumeSessionId).toBe("existing-conversation");
	}
});

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
	expect(ctx.checkpointAgent).toHaveBeenCalledWith(
		expect.objectContaining({
			rejected: expect.objectContaining({ attempts: 1, output: saved }),
		}),
	);
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
	expect(ctx.resumeAgent!.rejected).toBeUndefined();
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

async function guideFixture() {
	const f = await fixture();
	f.ctx.step = {
		id: "guide",
		name: "Guide",
		type: "agent",
		prompt: "Guide",
	} as ExecutionContext["step"];
	f.ctx.run.step = "pipeline/guide";
	f.ctx.run.outputs.ci = {
		baseSha: execFileSync("git", ["rev-parse", "HEAD^"], {
			cwd: f.ctx.run.workspace,
			encoding: "utf8",
		}).trim(),
	};
	const guide = {
		scope: {
			kind: "nonvisual",
			rationale: "Nonvisual feature fixture",
			files: ["other.txt"],
		},
		system: {
			lanes: [
				{ id: "input", name: "Input" },
				{ id: "processing", name: "Processing" },
				{ id: "output", name: "Output" },
			],
			parts: [
				{ id: "input", label: "Input", laneId: "input", status: "unchanged" },
				{
					id: "feature",
					label: "Feature",
					laneId: "processing",
					status: "changed",
				},
				{
					id: "output",
					label: "Output",
					laneId: "output",
					status: "unchanged",
				},
			],
			before: [],
			after: [],
		},
		tldr: "Complete guide overview",
		goal: "Feature",
		summary: "Feature",
		decision: {
			summaryShort: "Ready for review",
			status: "ready",
			summary: "Ready",
		},
		requirements: [
			{
				criterion: "Support feature",
				status: "supported",
				evidence: ["Verified"],
			},
		],
		behavior: [],
		checks: [],
		risks: [],
		reviewInstructions: ["Inspect"],
		chapters: [
			{
				systemPartIds: ["feature"],
				tldr: "Review the whole feature",
				beforeShort: "Old behavior",
				afterShort: "New behavior",
				risk: { level: "low", text: "Fixture only" },
				keyChecks: [
					{ do: "Open the feature", expect: "Read the complete evidence" },
				],
				id: "feature",
				title: "Feature",
				summary: "Feature",
				before: "Old",
				after: "New",
				requirementIndexes: [0],
				files: ["other.txt"],
				screenshots: [],
				diagrams: [],
				reviewChecks: ["Inspect"],
				risks: [],
				evidence: ["Verified"],
			},
		],
	};
	const invalid = structuredClone(guide);
	invalid.chapters[0]!.files.push("view.txt");
	f.ctx.resumeAgent!.result!.output = invalid;
	f.runner.getMessages = () => [
		{ type: "result", result: JSON.stringify(guide) },
	];
	return { ...f, guide, invalid };
}

it("validates recovered guide coverage and resumes the same conversation with exact issues", async () => {
	const f = await guideFixture();
	const output = await f.worker.executeFactoryAgent(f.ctx);
	expect(output).toMatchObject(f.guide);
	expect(output.reviewFiles).toMatchObject({
		headSha: f.ctx.progress!.reviewScope!.headSha,
		baseSha: f.ctx.progress!.reviewScope!.baseSha,
	});
	expect(f.getConfig().resumeSessionId).toBe("existing-conversation");
	expect(f.getInput().outputCorrection).toMatchObject({
		output: f.invalid,
		attempts: 1,
		issues: [
			{
				path: "/chapters/files",
				expected: ["other.txt"],
				actual: ["view.txt"],
			},
		],
	});
	expect(f.ctx.resumeAgent!.rejected).toBeUndefined();
});

it.each([
	false,
	true,
])("finalizes a customized restricted-input guide (saved result: %s)", async (saved) => {
	const f = await guideFixture();
	f.ctx.step.inputs = ["plan", "capture"];
	f.ctx.input = { plan: {}, capture: f.ctx.run.outputs.capture };
	if (saved) f.ctx.resumeAgent!.result!.output = f.guide;
	else delete f.ctx.resumeAgent!.result;
	const output = await f.worker.executeFactoryAgent(f.ctx);
	expect(output).toMatchObject(f.guide);
	expect(output.reviewFiles).toMatchObject({
		baseSha: (f.ctx.run.outputs.ci as { baseSha: string }).baseSha,
		headSha: f.ctx.progress!.currentRevision!.headSha,
	});
	expect(f.runner.start).toHaveBeenCalledTimes(saved ? 0 : 1);
	if (!saved) {
		expect(f.getInput().plan).toEqual({});
		expect(f.getInput().capture).toEqual(f.ctx.run.outputs.capture);
		expect(f.getInput().ci).toBeUndefined();
		expect(f.getInput().progress.newHistory).toEqual([]);
		expect(f.getInput().progress.reviewScope.files).toEqual(["other.txt"]);
	}
});

it("corrects fresh malformed JSON and missing PR files through the same boundary", async () => {
	const f = await guideFixture();
	delete f.ctx.resumeAgent!.result;
	let turn = 0;
	f.runner.getMessages = () => [
		{
			type: "result",
			result:
				turn++ === 0
					? "invalid JSON"
					: turn === 2
						? JSON.stringify({
								...f.guide,
								chapters: [{ ...f.guide.chapters[0], files: [] }],
							})
						: JSON.stringify(f.guide),
		},
	];
	await expect(f.worker.executeFactoryAgent(f.ctx)).resolves.toMatchObject(
		f.guide,
	);
	expect(f.runner.start).toHaveBeenCalledTimes(3);
	expect(f.getInput().outputCorrection).toMatchObject({
		attempts: 2,
		issues: [{ path: "/chapters/files", expected: ["other.txt"], actual: [] }],
	});
});

it("preserves a correction through pre-turn infrastructure failure without spending its budget", async () => {
	const f = await guideFixture();
	f.runner.start.mockRejectedValueOnce(new Error("Transport offline"));
	await expect(f.worker.executeFactoryAgent(f.ctx)).rejects.toThrow(
		"Transport offline",
	);
	const checkpoint = JSON.parse(JSON.stringify(f.ctx.resumeAgent));
	expect(checkpoint.rejected).toMatchObject({
		attempts: 0,
		reserved: false,
		output: f.invalid,
	});
	f.ctx.resumeAgent = checkpoint;
	await expect(f.worker.executeFactoryAgent(f.ctx)).resolves.toMatchObject(
		f.guide,
	);
	expect(f.getConfig().mcpConfig["factory-context"]).toMatchObject({
		required: true,
		startup_timeout_sec: 45,
	});
	expect(f.getConfig().resumeSessionId).toBe("existing-conversation");
});

it("refunds confirmed transport failures and still bounds repeated validation rejection", async () => {
	const f = await guideFixture();
	const start = f.runner.start.getMockImplementation()!;
	f.runner.start.mockImplementationOnce(async (...args) => {
		await start(...args);
		throw new Error("Transport offline after startup");
	});
	await expect(f.worker.executeFactoryAgent(f.ctx)).rejects.toThrow(
		"Transport offline after startup",
	);
	const checkpoint = JSON.parse(JSON.stringify(f.ctx.resumeAgent));
	expect(checkpoint.rejected).toMatchObject({
		attempts: 0,
		reserved: false,
		output: f.invalid,
	});
	expect(checkpoint.infrastructureFailure).toMatchObject({
		reason: "Transport offline after startup",
	});
	f.ctx.resumeAgent = checkpoint;
	f.runner.start.mockImplementation(start);
	f.runner.getMessages = () => [
		{ type: "result", result: JSON.stringify(f.invalid) },
	];
	await expect(f.worker.executeFactoryAgent(f.ctx)).rejects.toThrow(
		"exhausted after 2",
	);
	expect(f.ctx.resumeAgent!.rejected).toMatchObject({
		exhausted: true,
		attempts: 2,
	});
	const count = f.runner.start.mock.calls.length;
	await expect(f.worker.executeFactoryAgent(f.ctx)).rejects.toThrow(
		"exhausted",
	);
	expect(f.runner.start).toHaveBeenCalledTimes(count);
});

it("applies schema validation to recovered malformed guides before accepting them", async () => {
	const f = await guideFixture();
	f.ctx.resumeAgent!.result!.output = { chapters: [] };
	await expect(f.worker.executeFactoryAgent(f.ctx)).resolves.toMatchObject(
		f.guide,
	);
	expect(f.getInput().outputCorrection).toMatchObject({
		output: { chapters: [] },
		attempts: 1,
	});
	expect(
		f
			.getInput()
			.outputCorrection.issues.some(
				(issue: { path: string }) => issue.path === "/goal",
			),
	).toBe(true);
});

it("corrects recovered capture budget violations instead of replaying the same rejected output", async () => {
	const f = await fixture();
	(f.ctx.run.outputs["visual-scope"] as any).captureBudget = 2;
	f.ctx.resumeAgent!.result!.output = f.repaired;
	f.runner.getMessages = () => [
		{
			type: "result",
			result: JSON.stringify({
				screenshots: f.repaired.screenshots.slice(0, 2),
			}),
		},
	];
	await expect(f.worker.executeFactoryAgent(f.ctx)).resolves.toMatchObject({
		screenshots: f.repaired.screenshots.slice(0, 2),
	});
	expect(f.getInput().outputCorrection).toMatchObject({
		issues: [{ path: "/screenshots", expected: 2, actual: 3 }],
		attempts: 1,
	});
	expect(f.getConfig().resumeSessionId).toBe("existing-conversation");
});

it("bounds capture semantic corrections across finalization without resetting the rejection count", async () => {
	const f = await fixture();
	(f.ctx.run.outputs["visual-scope"] as any).captureBudget = 2;
	f.ctx.resumeAgent!.result!.output = f.repaired;
	await expect(f.worker.executeFactoryAgent(f.ctx)).rejects.toThrow(
		"exhausted after 2",
	);
	expect(f.runner.start).toHaveBeenCalledTimes(2);
	expect(f.ctx.resumeAgent!.rejected).toMatchObject({
		attempts: 2,
		exhausted: true,
	});
});

it("retries IO failures during correction by revalidating the completed candidate without another native turn", async () => {
	const f = await fixture();
	(f.ctx.run.outputs["visual-scope"] as any).captureBudget = 2;
	f.ctx.resumeAgent!.result!.output = f.repaired;
	f.runner.getMessages = () => [
		{
			type: "result",
			result: JSON.stringify({
				screenshots: f.repaired.screenshots.slice(0, 2),
			}),
		},
	];
	rmSync(f.repaired.screenshots[0]!.path);
	await expect(f.worker.executeFactoryAgent(f.ctx)).rejects.toThrow("ENOENT");
	expect(f.ctx.resumeAgent!.rejected?.attempts).toBe(1);
	expect(f.ctx.resumeAgent!.result?.finalizing).toBe(true);
	f.ctx.resumeAgent = JSON.parse(JSON.stringify(f.ctx.resumeAgent));
	writeFileSync(
		f.repaired.screenshots[0]!.path,
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 4]),
	);
	await expect(f.worker.executeFactoryAgent(f.ctx)).resolves.toMatchObject({
		screenshots: f.repaired.screenshots.slice(0, 2),
	});
	expect(f.runner.start).toHaveBeenCalledOnce();
	expect(f.ctx.resumeAgent!.rejected).toBeUndefined();
});

it("corrects invalid recommendation indices from a custom question-enabled role", async () => {
	const f = await fixture();
	f.ctx.step = {
		id: "custom-questions",
		name: "Questions",
		type: "agent",
		prompt: "Ask a question",
		askQuestions: true,
	};
	f.ctx.run.step = "custom-questions";
	const valid = {
		questions: ["Proceed?"],
		questionRecommendations: [
			{ questionIndex: 0, answer: "Wait", reason: "Approval needed" },
		],
		customField: true,
	};
	const invalid = {
		...valid,
		questionRecommendations: [
			{ ...valid.questionRecommendations[0], questionIndex: 2 },
		],
	};
	f.ctx.resumeAgent!.result!.output = invalid;
	f.runner.getMessages = () => [
		{ type: "result", result: JSON.stringify(valid) },
	];
	await expect(f.worker.executeFactoryAgent(f.ctx)).resolves.toEqual(valid);
	expect(f.getInput().outputCorrection).toMatchObject({
		attempts: 1,
		output: invalid,
	});
	expect(f.getInput().outputCorrection.issues).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				path: "/questionRecommendations/0/questionIndex",
			}),
		]),
	);
	expect(f.runner.start).toHaveBeenCalledOnce();
});

it.each([
	false,
	true,
])("retains extraction recommendations and corrects invalid inventory output (saved result: %s)", async (saved) => {
	const f = await fixture();
	f.ctx.step = {
		id: "extract-requirements",
		name: "Extract requirements",
		type: "agent",
		prompt: "Extract scope",
		askQuestions: true,
		reviewContract: "inventory-v1",
	};
	f.ctx.run.step = "extract-requirements";
	const source = { source: "originalInput", reference: "/acceptance/0" };
	const valid = {
		schemaVersion: 1,
		requirements: [
			{
				id: "R1",
				criterion: "Reject blank strings",
				classification: "active",
				sources: [source],
			},
		],
		decisions: [],
		conflicts: [],
		sourceReceipt: { considered: [source], unavailable: [] },
		questions: ["Should blank strings be rejected?"],
		questionRecommendations: [
			{
				questionIndex: 0,
				answer: "Reject blank strings",
				reason: "Required by the caller contract",
			},
		],
	};
	const invalid = { ...valid, requirements: [] };
	if (saved) f.ctx.resumeAgent!.result!.output = invalid;
	else delete f.ctx.resumeAgent!.result;
	let turn = 0;
	f.runner.getMessages = () => [
		{
			type: "result",
			result: JSON.stringify(!saved && turn++ === 0 ? invalid : valid),
		},
	];
	const output = await f.worker.executeFactoryAgent(f.ctx);
	expect(output).toMatchObject(valid);
	expect(output.decisions).toEqual([]);
	expect(f.runner.start).toHaveBeenCalledTimes(saved ? 1 : 2);
	expect(f.getInput().outputCorrection).toMatchObject({
		output: invalid,
		attempts: 1,
	});
	expect(f.getInput().outputCorrection.issues).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ path: "/requirements" }),
		]),
	);
});

it("gives saved review fixers question guidance even without askQuestions", async () => {
	const f = await fixture();
	f.ctx.step = {
		id: "visual-fix",
		name: "Fix review findings",
		type: "agent",
		prompt: "Saved custom fixer prompt",
		askQuestions: false,
	};
	f.ctx.run.step = "pipeline/visual-fix";
	f.ctx.resumeAgent = { runner: "codex", sessionId: "existing-conversation" };
	const output = {
		summary: "Real-agent checks still need a decision.",
		questions: ["Should I run the remaining tests with real agents?"],
		dispositions: [],
	};
	f.runner.getMessages = () => [
		{ type: "result", result: JSON.stringify(output) },
	];
	await expect(f.worker.executeFactoryAgent(f.ctx)).resolves.toMatchObject(
		output,
	);
	const instruction = f.worker.buildAgentRunnerConfig.mock.calls[0]![3];
	expect(instruction).toContain(questionInstructions(f.ctx.run.id));
	expect(f.getConfig().resumeSessionId).toBe("existing-conversation");
	expect(f.ctx.step.prompt).toBe("Saved custom fixer prompt");
	expect(f.ctx.step.askQuestions).toBe(false);
});

it("resumes one silent Codex turn in the same conversation and persists the retry budget", async () => {
	const f = await fixture();
	f.ctx.resumeAgent = { runner: "codex", sessionId: "existing-conversation" };
	f.runner.getMessages = () =>
		f.runner.start.mock.calls.length === 1
			? [
					{
						type: "result",
						is_error: true,
						errors: ["codex app-server produced no activity for 300000ms"],
					},
				]
			: [{ type: "result", result: JSON.stringify(f.repaired) }];
	await expect(f.worker.executeFactoryAgent(f.ctx)).resolves.toMatchObject(
		f.repaired,
	);
	expect(f.runner.start).toHaveBeenCalledTimes(2);
	expect(f.getConfig().resumeSessionId).toBe("existing-conversation");
	expect(f.ctx.resumeAgent?.idleRetries).toBe(1);
});

it("never retries a repeatedly silent or cancelled turn indefinitely", async () => {
	const f = await fixture();
	f.ctx.resumeAgent = { runner: "codex", sessionId: "existing-conversation" };
	f.runner.getMessages = () => [
		{
			type: "result",
			is_error: true,
			errors: ["codex app-server produced no activity for 300000ms"],
		},
	];
	await expect(f.worker.executeFactoryAgent(f.ctx)).rejects.toThrow(
		"no activity",
	);
	expect(f.runner.start).toHaveBeenCalledTimes(2);
	await expect(f.worker.executeFactoryAgent(f.ctx)).rejects.toThrow(
		"no activity",
	);
	expect(f.runner.start).toHaveBeenCalledTimes(3);
	const cancelled = new AbortController();
	cancelled.abort();
	f.ctx.signal = cancelled.signal;
	await expect(f.worker.executeFactoryAgent(f.ctx)).rejects.toThrow();
	expect(f.runner.start).toHaveBeenCalledTimes(3);
});

it("corrects a missing nonvisual map through the same guide-only conversation", async () => {
	const f = await guideFixture();
	const { system: _, ...missing } = f.guide;
	f.ctx.resumeAgent!.result!.output = missing;
	const output = await f.worker.executeFactoryAgent(f.ctx);
	expect(output).toMatchObject(f.guide);
	expect(f.getConfig().resumeSessionId).toBe("existing-conversation");
	expect(
		f.getInput().outputCorrection.issues.map((i: { path: string }) => i.path),
	).toContain("/system");
	expect(f.worker.buildAgentRunnerConfig.mock.calls[0][3]).toContain(
		"scope:{kind:",
	);
	expect(f.worker.buildAgentRunnerConfig.mock.calls[0][3]).toContain(
		"guide-only output correction",
	);
	expect(f.ctx.checkpointAgent).toHaveBeenCalled();
	expect(f.runner.start).toHaveBeenCalledTimes(1);
});
