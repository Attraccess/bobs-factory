import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
	defaultWorkflows,
	upgradeWorkflows,
} from "../src/factory/defaultWorkflows.js";
import { qaDigest } from "../src/factory/EvidenceDigest.js";
import { validateFactoryResult } from "../src/factory/FactoryResults.js";
import { CaptureSchema } from "../src/factory/FactoryTools.js";
import { scopeRevision } from "../src/factory/RepositoryScope.js";
import {
	byteRange,
	cleanupVideoEvidence,
	evidenceFile,
	finalizeVideoEvidence,
	type VideoCapture,
	VideoTaskSchema,
	videoGateIssues,
	videoLimits,
	videoScopeIssues,
} from "../src/factory/Video.js";
import { videoPrompts } from "../src/factory/videoPrompts.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { FactoryServer } from "./fixtures/authenticated-factory.js";
import { qaScope } from "./fixtures/qa.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
function setup() {
	const home = mkdtempSync(join(tmpdir(), "factory-video-test-"));
	roots.push(home);
	const workspace = join(home, "repo");
	mkdirSync(workspace);
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: workspace, encoding: "utf8" }).trim();
	git("init", "-b", "main");
	git("config", "user.email", "fixture@example.test");
	git("config", "user.name", "Fixture");
	git("config", "commit.gpgsign", "false");
	writeFileSync(join(workspace, "view.txt"), "Saved record");
	git("add", ".");
	git("commit", "-m", "fixture");
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	const run = runtime.create({
		id: "video-run",
		triggerOrigin: {
			type: "manual",
			workflowId: "factory",
			at: new Date().toISOString(),
		},
		title: "Video",
		repositoryId: "fixture",
		workspace,
		input: "",
		workflow: defaultWorkflows.find((w) => w.id === "factory")!,
	});
	const evidenceDir = join(runtime.directory, "evidence", run.id);
	mkdirSync(evidenceDir, { recursive: true });
	const task = VideoTaskSchema.parse({
		id: "save-demo",
		title: "Save",
		storyIds: ["save"],
		criterionIds: ["saved"],
		rationale: "Shows feedback",
		steps: ["Click Save", "See confirmation"],
		dependencies: ["view.txt"],
		environment: "seeded record 42",
		targetSeconds: 30,
	});
	const scope = {
		videoContract: "video-v1",
		videoTasks: [task],
		stories: qaScope("ui").stories,
	};
	run.outputs["visual-scope"] = scope;
	const ctx = {
		run,
		step: defaultWorkflows
			.find((w) => w.id === "factory-pipeline")!
			.steps.find((s) => s.id === "capture")!,
		evidenceDir,
		signal: new AbortController().signal,
		log: () => {},
		input: {},
		progress: {
			visit: 1,
			changedFiles: [],
			uncertain: false,
			unchangedCode: true,
			newHistory: [],
			currentRevision: {
				headSha: git("rev-parse", "HEAD"),
				dirty: false,
				historyLength: 0,
				at: new Date().toISOString(),
			},
		},
	} as ExecutionContext;
	const path = join(evidenceDir, "save.mp4"),
		posterPath = join(evidenceDir, "save.png");
	execFileSync("ffmpeg", [
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"testsrc=size=320x240:rate=10",
		"-t",
		"1",
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-movflags",
		"+faststart",
		path,
	]);
	execFileSync("ffmpeg", [
		"-v",
		"error",
		"-i",
		path,
		"-frames:v",
		"1",
		posterPath,
	]);
	const output = CaptureSchema.parse({
		screenshots: [],
		videoContract: "video-v1",
		videos: [
			{
				taskId: task.id,
				path,
				caption: "Save feedback",
				recorder: "validation fixture (synthetic, not a demonstration)",
				receipt: {
					executed: true,
					action: "ffmpeg testsrc",
					details: "One second real encoded test media",
				},
				storyIds: task.storyIds,
				criterionIds: task.criterionIds,
				viewport: { width: 320, height: 240 },
				transcript: "Media validation fixture",
				environment: task.environment,
				posterPath,
			},
		],
	});
	return {
		home,
		runtime,
		run,
		ctx,
		scope,
		task,
		output,
		path,
		posterPath,
		git,
	};
}

it("bounds tasks, links scenarios and supports nonvisual/no-video selection", () => {
	const t = VideoTaskSchema.parse({
		id: "demo",
		title: "Demo",
		storyIds: ["story"],
		criterionIds: ["criterion"],
		rationale: "Flow",
		steps: ["Click"],
		dependencies: ["view.ts"],
		environment: "seed",
		targetSeconds: 30,
	});
	expect(
		videoScopeIssues({
			videoContract: "video-v1",
			videoTasks: [t],
			stories: [{ id: "story", criteria: [{ id: "criterion" }] }],
		}),
	).toEqual([]);
	expect(
		videoScopeIssues({
			videoContract: "video-v1",
			videoTasks: [],
			stories: [],
		}),
	).toHaveLength(1);
	expect(
		videoScopeIssues({
			videoContract: "video-v1",
			videoReason: "Backend only",
			stories: [],
		}),
	).toEqual([]);
	expect(
		videoScopeIssues({
			videoContract: "video-v1",
			videoTasks: [t, t],
			stories: [],
		}),
	).toHaveLength(3);
	expect(CaptureSchema.parse({ screenshots: [] })).not.toHaveProperty("videos");
});
it("validates actual media, stamps provenance, preserves original capture revision on accepted unaffected reuse", async () => {
	const f = setup();
	const capture = (await finalizeVideoEvidence(
		f.ctx,
		f.output,
	)) as VideoCapture;
	const v = capture.videos![0];
	expect(v.validation).toMatchObject({
		mime: "video/mp4",
		duration: 1,
		bytes: readFileSync(f.path).length,
		captureRevision: f.ctx.progress!.currentRevision!.headSha,
		dirty: false,
	});
	f.run.outputs.capture = capture;
	expect(
		(await videoGateIssues(f.ctx, f.git("rev-parse", "HEAD"))).blocked,
	).toEqual(["save-demo: No exact inspected-playback acceptance receipt"]);
	f.run.outputs["visual-review"] = {
		acceptedVideos: [
			{
				taskId: v.taskId,
				sha256: v.validation!.sha256,
				inspectedPlayback: true,
			},
		],
	};
	expect(await videoGateIssues(f.ctx, f.git("rev-parse", "HEAD"))).toEqual({
		blocked: [],
		failures: [],
	});
	f.ctx.progress!.previousOutput = structuredClone(capture);
	writeFileSync(join(f.run.workspace, "other.txt"), "unrelated");
	f.git("add", ".");
	f.git("commit", "-m", "other");
	f.task.changed = false;
	(f.run.outputs["visual-scope"] as any).videoTasks = [f.task];
	f.ctx.progress!.currentRevision!.headSha = f.git("rev-parse", "HEAD");
	f.ctx.progress!.unchangedCode = false;
	// Unexplained changes are deliberately not eligible for reuse.
	f.ctx.progress!.changedFiles = ["other.txt"];
	await expect(
		finalizeVideoEvidence(f.ctx, structuredClone(capture)),
	).rejects.toThrow("Reuse lacks");
	(f.run.outputs["visual-scope"] as any).nonVisualFiles = ["other.txt"];
	const reused = (await finalizeVideoEvidence(
		f.ctx,
		structuredClone(capture),
	)) as VideoCapture;
	expect(reused.videos![0].reused).toBe(true);
	expect(reused.videos![0].validation!.captureRevision).toBe(
		v.validation!.captureRevision,
	);
	expect(reused.videos![0].validation!.validatedRevision).not.toBe(
		v.validation!.captureRevision,
	);
	f.ctx.progress!.uncertain = true;
	await expect(
		finalizeVideoEvidence(f.ctx, structuredClone(capture)),
	).rejects.toThrow("Reuse lacks");
});
it("validates grouped recording sources and rejects changes in a secondary repository", async () => {
	const f = setup();
	const primary = f.run.workspace;
	const secondary = join(f.home, "api");
	mkdirSync(secondary);
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: secondary, encoding: "utf8" }).trim();
	git("init", "-b", "main");
	git("config", "user.email", "fixture@example.test");
	git("config", "user.name", "Fixture");
	git("config", "commit.gpgsign", "false");
	writeFileSync(join(secondary, "view.txt"), "API fixture");
	git("add", ".");
	git("commit", "-m", "fixture");
	f.run.workspace = f.home;
	f.run.repositories = [primary, secondary].map((workspace, i) => ({
		id: `repository-${i}`,
		name: i ? "api" : "repo",
		workspace,
		repositoryPath: workspace,
		baseBranch: "main",
	}));
	f.task.dependencies = ["repo/view.txt", "api/view.txt"];
	const capture = (await finalizeVideoEvidence(
		f.ctx,
		f.output,
	)) as VideoCapture;
	const video = capture.videos![0];
	f.run.outputs.capture = capture;
	f.run.outputs["visual-review"] = {
		acceptedVideos: [
			{
				taskId: video.taskId,
				sha256: video.validation!.sha256,
				inspectedPlayback: true,
			},
		],
	};
	const head = f.ctx.progress!.currentRevision!.headSha;
	expect(await videoGateIssues(f.ctx, head)).toEqual({
		blocked: [],
		failures: [],
	});
	f.ctx.progress!.previousOutput = structuredClone(capture);
	expect(
		(
			(await finalizeVideoEvidence(
				f.ctx,
				structuredClone(capture),
			)) as VideoCapture
		).videos![0].reused,
	).toBe(true);
	writeFileSync(join(secondary, "view.txt"), "Changed API fixture");
	expect((await videoGateIssues(f.ctx, head)).blocked).toEqual([
		"save-demo: Recording source dependencies changed",
	]);
	await expect(
		finalizeVideoEvidence(f.ctx, structuredClone(capture)),
	).rejects.toThrow("Reuse lacks");
});
it("requires fresh recordings after linked scenario changes but permits unrelated story changes", async () => {
	const f = setup();
	const capture = (await finalizeVideoEvidence(
		f.ctx,
		f.output,
	)) as VideoCapture;
	const video = capture.videos![0];
	f.run.outputs.capture = capture;
	f.run.outputs["visual-review"] = {
		acceptedVideos: [
			{
				taskId: video.taskId,
				sha256: video.validation!.sha256,
				inspectedPlayback: true,
			},
		],
	};
	f.ctx.progress!.previousOutput = structuredClone(capture);
	const original = structuredClone(f.scope.stories[0]);
	for (const change of [
		{ fixtures: ["Different seeded record"] },
		{ preconditions: ["Read-only account"] },
		{ actions: ["Save then reload"] },
		{ criteria: [{ id: "saved", expected: "Record survives reload" }] },
	]) {
		f.scope.stories[0] = { ...original, ...change };
		await expect(
			finalizeVideoEvidence(f.ctx, structuredClone(capture)),
		).rejects.toThrow("Reuse lacks");
		expect(
			(await videoGateIssues(f.ctx, f.git("rev-parse", "HEAD"))).blocked,
		).toEqual(["save-demo: Stale or unverified recording"]);
	}
	f.scope.stories[0] = original;
	f.scope.stories.push({
		...original,
		id: "unrelated",
		fixtures: ["Unrelated fixture"],
	});
	const reused = (await finalizeVideoEvidence(
		f.ctx,
		structuredClone(capture),
	)) as VideoCapture;
	expect(reused.videos![0].reused).toBe(true);
	f.run.outputs.capture = reused;
	expect(await videoGateIssues(f.ctx, f.git("rev-parse", "HEAD"))).toEqual({
		blocked: [],
		failures: [],
	});
	// Older receipts only hashed the task, so cannot establish scenario equivalence.
	const legacy = structuredClone(capture);
	legacy.videos![0].validation!.taskDigest = qaDigest({
		...f.task,
		changed: undefined,
	});
	f.ctx.progress!.previousOutput = legacy;
	await expect(
		finalizeVideoEvidence(f.ctx, structuredClone(legacy)),
	).rejects.toThrow("Reuse lacks");
});
it("rejects escaped assets, truncated media, fabricated metadata, absent captions and changed bytes", async () => {
	const f = setup();
	copyFileSync(f.path, join(f.home, "outside.mp4"));
	symlinkSync(
		join(f.home, "outside.mp4"),
		join(f.ctx.evidenceDir, "escape.mp4"),
	);
	expect(() =>
		evidenceFile(join(f.ctx.evidenceDir, "escape.mp4"), f.ctx.evidenceDir),
	).toThrow("inside");
	const bad = structuredClone(f.output);
	bad.videos![0].path = join(f.ctx.evidenceDir, "truncated.mp4");
	writeFileSync(bad.videos![0].path, readFileSync(f.path).subarray(0, 100));
	await expect(finalizeVideoEvidence(f.ctx, bad)).rejects.toThrow();
	const capture = (await finalizeVideoEvidence(
		f.ctx,
		f.output,
	)) as VideoCapture;
	f.run.outputs.capture = capture;
	writeFileSync(f.path, "replacement");
	expect(
		(await videoGateIssues(f.ctx, f.git("rev-parse", "HEAD"))).blocked[0],
	).toContain("bytes changed");
});
it("reports optional missing tools without blocking fresh QA; required video or product failure cannot pass", async () => {
	const f = setup();
	f.run.outputs.capture = {
		videoContract: "video-v1",
		videos: [],
		videoUnavailable: [
			{ taskId: f.task.id, reason: "ffmpeg unavailable", cause: "tooling" },
		],
	};
	expect(await videoGateIssues(f.ctx, f.git("rev-parse", "HEAD"))).toEqual({
		blocked: [],
		failures: [],
	});
	f.task.required = true;
	expect(
		(await videoGateIssues(f.ctx, f.git("rev-parse", "HEAD"))).blocked[0],
	).toContain("ffmpeg unavailable");
	(f.run.outputs.capture as VideoCapture).videoUnavailable![0].cause =
		"product";
	expect(
		(await videoGateIssues(f.ctx, f.git("rev-parse", "HEAD"))).failures[0],
	).toMatchObject({ rating: 3, status: "open" });
});
it("streams full/HEAD/open/suffix ranges and rejects stale, malformed, replaced and expired media", async () => {
	const f = setup();
	f.run.outputs.capture = await finalizeVideoEvidence(f.ctx, f.output);
	const video = (f.run.outputs.capture as VideoCapture).videos![0];
	const server = new FactoryServer(f.runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {
			throw Error("unused");
		},
		stop: () => {},
	});
	const url = `/api/runs/${f.run.id}/videos/${video.taskId}/media?v=${video.validation!.sha256}`;
	const get = (range?: string, method: "GET" | "HEAD" = "GET") =>
		server.app.inject({
			url,
			method,
			headers: { host: "localhost", ...(range ? { range } : {}) },
		});
	try {
		const bytes = readFileSync(f.path);
		for (const asset of ["media", "poster", "captions"]) {
			for (const method of ["GET", "HEAD"] as const) {
				const denied = await server.app.inject({
					url: url.replace("/media?", `/${asset}?`),
					method,
					headers: { cookie: "", range: "bytes=0-9" },
				});
				expect(denied.statusCode).toBe(401);
				expect(denied.headers["cache-control"]).toBe("no-store");
			}
		}
		expect((await get()).rawPayload).toEqual(bytes);
		const head = await get(undefined, "HEAD");
		expect(head.statusCode).toBe(200);
		expect(head.body).toBe("");
		expect(Number(head.headers["content-length"])).toBe(bytes.length);
		for (const [range, start, end] of [
			["bytes=0-9", 0, 9],
			["bytes=10-", 10, bytes.length - 1],
			["bytes=-12", bytes.length - 12, bytes.length - 1],
		] as const) {
			const r = await get(range);
			expect(r.statusCode).toBe(206);
			expect(r.headers["content-range"]).toBe(
				`bytes ${start}-${end}/${bytes.length}`,
			);
			expect(r.rawPayload).toEqual(bytes.subarray(start, end + 1));
		}
		for (const range of [
			"bytes=0-1,3-4",
			"bytes=-0",
			"bytes=999999-",
			"nonsense",
			"bytes=5-1",
		]) {
			const r = await get(range);
			expect(r.statusCode).toBe(416);
			expect(r.headers["content-range"]).toBe(`bytes */${bytes.length}`);
		}
		expect(
			(
				await server.app.inject({
					url: url.replace(video.validation!.sha256, "stale"),
					headers: { host: "localhost" },
				})
			).statusCode,
		).toBe(409);
		writeFileSync(f.path, Buffer.alloc(bytes.length));
		expect((await get("bytes=0-9")).statusCode).toBe(409);
		rmSync(f.path);
		expect((await get()).statusCode).toBe(410);
		server.auth.logout("route-fixture-session", "http://localhost");
		expect((await get("bytes=0-9")).statusCode).toBe(401);
	} finally {
		await server.stop();
		await f.runtime.shutdown();
	}
});
it("serves grouped assets from retained worktrees and rejects any stale, dirty or missing repository", async () => {
	const f = setup();
	const secondary = join(f.home, "api");
	mkdirSync(secondary);
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: secondary, encoding: "utf8" }).trim();
	git("init", "-b", "main");
	git("config", "user.name", "Fixture");
	git("config", "user.email", "fixture@example.test");
	git("config", "commit.gpgsign", "false");
	writeFileSync(join(secondary, "view.txt"), "API response");
	git("add", ".");
	git("commit", "-m", "fixture");
	f.run.repositories = [f.run.workspace, secondary].map((workspace, i) => ({
		id: i ? "api" : "app",
		name: i ? "api" : "app",
		workspace,
		repositoryPath: workspace,
		baseBranch: "main",
	}));
	f.run.workspace = f.home; // Non-Git parent, as in a grouped product run.
	f.task.dependencies = ["repo/view.txt", "api/view.txt"];
	f.ctx.progress!.currentRevision!.headSha = scopeRevision([
		{ repositoryId: "app", headSha: f.git("rev-parse", "HEAD") },
		{ repositoryId: "api", headSha: git("rev-parse", "HEAD") },
	]);
	const captions = join(f.ctx.evidenceDir, "save.vtt");
	writeFileSync(captions, "WEBVTT\n\n00:00.000 --> 00:01.000\nSaved\n");
	f.output.videos![0]!.captionsPath = captions;
	f.run.outputs.capture = await finalizeVideoEvidence(f.ctx, f.output);
	const video = (f.run.outputs.capture as VideoCapture).videos![0]!;
	const server = new FactoryServer(f.runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {
			throw Error("unused");
		},
		stop: () => {},
	});
	const request = (
		asset: string,
		method: "GET" | "HEAD" = "GET",
		range?: string,
	) =>
		server.app.inject({
			url: `/api/runs/${f.run.id}/videos/${video.taskId}/${asset}?v=${video.validation!.sha256}`,
			method,
			headers: { ...(range ? { range } : {}) },
		});
	try {
		for (const [asset, path] of [
			["media", f.path],
			["poster", f.posterPath],
			["captions", captions],
		]) {
			const bytes = readFileSync(path!);
			const full = await request(asset!);
			expect(full.statusCode).toBe(200);
			expect(full.rawPayload).toEqual(bytes);
			const head = await request(asset!, "HEAD");
			expect(head.statusCode).toBe(200);
			expect(Number(head.headers["content-length"])).toBe(bytes.length);
			expect(head.body).toBe("");
			const range = await request(asset!, "GET", "bytes=0-9");
			expect(range.statusCode).toBe(206);
			expect(range.rawPayload).toEqual(bytes.subarray(0, 10));
			expect((await request(asset!, "HEAD", "bytes=-10")).statusCode).toBe(206);
		}
		writeFileSync(join(secondary, "view.txt"), "Changed API");
		for (const asset of ["media", "poster", "captions"])
			expect((await request(asset)).statusCode).toBe(409);
		git("add", ".");
		git("commit", "-m", "changed");
		expect((await request("media")).statusCode).toBe(409);
		git("checkout", "HEAD~1");
		expect((await request("media")).statusCode).toBe(200);
		rmSync(secondary, { recursive: true });
		expect((await request("media")).statusCode).toBe(409);
	} finally {
		await server.stop();
		await f.runtime.shutdown();
	}
});
it("cleans only expired terminal evidence and keeps active referenced files and metadata", async () => {
	const f = setup();
	f.run.outputs.capture = await finalizeVideoEvidence(f.ctx, f.output);
	f.run.updatedAt = new Date(
		Date.now() - videoLimits.terminalMs - 1000,
	).toISOString();
	cleanupVideoEvidence(join(f.runtime.directory, "evidence"), [f.run]);
	expect(existsSync(f.path)).toBe(true);
	f.run.status = "completed";
	cleanupVideoEvidence(join(f.runtime.directory, "evidence"), [f.run]);
	expect(existsSync(f.path)).toBe(false);
	expect(
		(f.run.outputs.capture as VideoCapture).videos![0].validation,
	).toBeDefined();
});
it("expires superseded recordings and their posters/captions retained in capture history", async () => {
	const f = setup();
	const earlier = (await finalizeVideoEvidence(
		f.ctx,
		f.output,
	)) as VideoCapture;
	const captions = join(f.ctx.evidenceDir, "earlier.vtt");
	writeFileSync(captions, "WEBVTT\n\n00:00.000 --> 00:01.000\nSaved\n");
	earlier.videos![0].captionsPath = captions;
	f.run.history.push({
		step: "pipeline/capture",
		output: structuredClone(earlier),
		at: f.run.updatedAt,
	});
	// Reuse can leave duplicate references in multiple historical capture rounds.
	f.run.history.push({
		step: "pipeline/capture",
		output: structuredClone(earlier),
		at: f.run.updatedAt,
	});
	const latest = structuredClone(earlier);
	latest.videos![0].path = join(f.ctx.evidenceDir, "latest.mp4");
	latest.videos![0].posterPath = join(f.ctx.evidenceDir, "latest.png");
	delete latest.videos![0].captionsPath;
	copyFileSync(f.path, latest.videos![0].path);
	copyFileSync(f.posterPath, latest.videos![0].posterPath);
	f.run.outputs.capture = latest;
	f.run.status = "completed";
	const now = Date.parse(f.run.updatedAt) + videoLimits.terminalMs + 1000;
	cleanupVideoEvidence(join(f.runtime.directory, "evidence"), [f.run], now);
	for (const path of [
		f.path,
		f.posterPath,
		captions,
		latest.videos![0].path,
		latest.videos![0].posterPath,
	])
		expect(existsSync(path)).toBe(false);
	expect(f.run.history[0].output).toEqual(earlier);
	expect(f.run.outputs.capture).toEqual(latest);
});
it("makes progress across cleanup passes without deleted or missing assets consuming the budget", () => {
	const f = setup();
	const root = join(f.runtime.directory, "evidence");
	const runs = Array.from({ length: 101 }, (_, i) => {
		const id = `expired-${i}`;
		const directory = join(root, id);
		mkdirSync(directory);
		const path = join(directory, "save.mp4"),
			posterPath = join(directory, "save.png");
		writeFileSync(path, "encoded media placeholder for deletion");
		writeFileSync(posterPath, "poster placeholder for deletion");
		return {
			...f.run,
			id,
			status: "completed" as const,
			outputs: {
				capture: {
					videos: [
						{
							...f.output.videos![0],
							path,
							posterPath,
							captionsPath: join(directory, "missing.vtt"),
						},
					],
				},
			},
		};
	});
	const now = Date.parse(f.run.updatedAt) + videoLimits.terminalMs + 1000;
	cleanupVideoEvidence(root, runs, now);
	expect(existsSync(runs[99].outputs.capture.videos[0].path)).toBe(false);
	expect(existsSync(runs[100].outputs.capture.videos[0].path)).toBe(true);
	cleanupVideoEvidence(root, runs, now);
	for (const run of runs) {
		expect(existsSync(run.outputs.capture.videos[0].path)).toBe(false);
		expect(existsSync(run.outputs.capture.videos[0].posterPath)).toBe(false);
	}
});
it("upgrades previous coherent stock prompts idempotently and leaves custom recipes unchanged", () => {
	const saved = structuredClone(defaultWorkflows),
		pipeline = saved.find((w) => w.id === "factory-pipeline")!;
	for (const s of pipeline.steps) {
		delete s.videoContract;
		if (s.prompt && videoPrompts[s.id])
			s.prompt = s.prompt.replace(videoPrompts[s.id], "");
	}
	pipeline.steps.find((s) => s.id === "capture")!.model = "kept-model";
	const upgraded = validateWorkflows(upgradeWorkflows(saved));
	expect(
		upgraded
			.find((w) => w.id === "factory-pipeline")!
			.steps.find((s) => s.id === "capture"),
	).toMatchObject({ videoContract: "video-v1", model: "kept-model" });
	expect(upgradeWorkflows(upgraded)).toEqual(upgraded);
	pipeline.steps.find((s) => s.id === "capture")!.prompt = "Custom recorder";
	expect(
		validateWorkflows(upgradeWorkflows(saved))
			.find((w) => w.id === "factory-pipeline")!
			.steps.find((s) => s.id === "visual-scope")!.videoContract,
	).toBeUndefined();
});
it("rejects invalid ranges at numeric boundaries", () => {
	expect(() => byteRange("bytes=9007199254740992-", 20)).toThrow();
	expect(byteRange("bytes=-100", 20)).toEqual({ start: 0, end: 19 });
});

it("enforces duration, file size, caption and poster validation before accepting evidence", async () => {
	const f = setup();
	const long = join(f.ctx.evidenceDir, "long.mp4");
	execFileSync("ffmpeg", [
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"color=c=blue:size=32x32:rate=1",
		"-t",
		"121",
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		long,
	]);
	const oversized = join(f.ctx.evidenceDir, "oversized.mp4");
	writeFileSync(oversized, Buffer.alloc(1));
	const { truncateSync } = await import("node:fs");
	truncateSync(oversized, videoLimits.bytes + 1);
	expect(() => evidenceFile(oversized, f.ctx.evidenceDir)).toThrow(
		"size limit",
	);
	const tooLong = structuredClone(f.output);
	tooLong.videos![0].path = long;
	await expect(finalizeVideoEvidence(f.ctx, tooLong)).rejects.toThrow(
		"duration",
	);
	const audio = join(f.ctx.evidenceDir, "audio.mp4");
	execFileSync("ffmpeg", [
		"-v",
		"error",
		"-i",
		f.path,
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=1000",
		"-shortest",
		"-c:v",
		"copy",
		"-c:a",
		"aac",
		audio,
	]);
	const withAudio = structuredClone(f.output);
	withAudio.videos![0].path = audio;
	await expect(finalizeVideoEvidence(f.ctx, withAudio)).rejects.toThrow(
		"timed captions",
	);
	const captions = join(f.ctx.evidenceDir, "caption.vtt");
	writeFileSync(
		captions,
		"WEBVTT\n\n00:00.000 --> 00:01.000\nTone during the saved confirmation.\n",
	);
	withAudio.videos![0].captionsPath = captions;
	expect(
		((await finalizeVideoEvidence(f.ctx, withAudio)) as VideoCapture).videos![0]
			.validation!.captions!.sha256,
	).toHaveLength(64);
	writeFileSync(captions, "WEBVTT\n\ninvalid cue");
	await expect(finalizeVideoEvidence(f.ctx, withAudio)).rejects.toThrow(
		"timed cues",
	);
	const invalidPoster = join(f.ctx.evidenceDir, "invalid.png");
	writeFileSync(invalidPoster, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
	const badPoster = structuredClone(f.output);
	badPoster.videos![0].posterPath = invalidPoster;
	await expect(finalizeVideoEvidence(f.ctx, badPoster)).rejects.toThrow();
});

it("rejects every malformed caption cue while preserving valid WebVTT timing variants", async () => {
	const f = setup();
	const audio = join(f.ctx.evidenceDir, "audio.mp4"),
		captions = join(f.ctx.evidenceDir, "captions.vtt");
	execFileSync("ffmpeg", [
		"-v",
		"error",
		"-i",
		f.path,
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=1000",
		"-shortest",
		"-c:v",
		"copy",
		"-c:a",
		"aac",
		audio,
	]);
	const output = structuredClone(f.output);
	output.videos![0].path = audio;
	output.videos![0].captionsPath = captions;
	const validCue = "00:00.000 --> 00:01.000\nConfirmation";
	for (const body of [
		"00:99.000 --> 00:99.500\nInvalid seconds",
		"60:00.000 --> 60:01.000\nInvalid minutes",
		"00:60:00.000 --> 01:00:01.000\nInvalid hour-form minutes",
		"00:04.000 --> 00:01.000\nReversed",
		"00:01.000 --> 00:01.000\nEmpty interval",
		"00:00.000 --> 00:01.00\nMalformed fraction",
		"00:00.000\n-->\n00:01.000\nBroken timing line",
		`${validCue}\n\n00:99.000 --> 00:99.500\nInvalid later cue`,
		`00:00.500 --> 00:01.000\nFirst\n\n${validCue}`,
		`${validCue}\n00:99.000 --> 00:99.500\nMissing separator`,
		"00:00.000 --> 00:01.000 --> 00:02.000\nExtra arrow",
		"00:00.000 --> 00:01.000\n",
		`NOTE\n${validCue}`,
		`STYLE\n${validCue}`,
	]) {
		writeFileSync(captions, `WEBVTT\n\n${body}\n`);
		await expect(
			finalizeVideoEvidence(f.ctx, structuredClone(output)),
		).rejects.toMatchObject({
			issues: [
				{
					path: "/videos/0",
					message: expect.stringMatching(/Caption.*timed cue/),
				},
			],
		});
	}
	for (const content of [
		`WEBVTT\n\n${validCue}\n`,
		"\uFEFFWEBVTT Captions\r\n\r\nNOTE A comment\r\n\r\nSTYLE\r\n::cue { color: white; }\r\n\r\nfirst\r\n00:00:00.000 --> 00:00:00.900 align:start\r\nFirst line\r\nSecond line\r\n\r\nsecond\r\n00:00.500 --> 00:01.000\r\nOverlapping cue\r\n",
		"WEBVTT\n\n00:59.999 --> 01:00.000\nMinute rollover\n\n100:00:00.000 --> 100:00:00.001\nLong hour form\n",
		"WEBVTT\n\n00:00.000 --> 00:00.800\nFirst\n\n00:00.000 --> 00:01.000\nEqual start\n",
	]) {
		writeFileSync(captions, content);
		const accepted = (await finalizeVideoEvidence(
			f.ctx,
			structuredClone(output),
		)) as VideoCapture;
		expect(accepted.videos![0].validation!.captions).toMatchObject({
			path: evidenceFile(captions, f.ctx.evidenceDir),
			sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
		});
	}
}, 30000);

it("does not let terminal cleanup follow a run-directory symlink or crash on a dangling temporary link", async () => {
	const f = setup();
	f.run.outputs.capture = await finalizeVideoEvidence(f.ctx, f.output);
	const broken = join(f.ctx.evidenceDir, "video-temp-broken.mp4");
	symlinkSync(join(f.home, "missing"), broken);
	f.run.status = "completed";
	expect(() =>
		cleanupVideoEvidence(join(f.runtime.directory, "evidence"), [f.run]),
	).not.toThrow();
	const outside = join(f.home, "outside");
	mkdirSync(outside);
	const media = join(outside, "private.mp4");
	writeFileSync(media, "preserve me");
	symlinkSync(outside, join(f.runtime.directory, "evidence", "outside-run"));
	const malicious = {
		...f.run,
		id: "outside-run",
		updatedAt: new Date(
			Date.now() - videoLimits.terminalMs - 1000,
		).toISOString(),
		outputs: { capture: { videos: [{ path: media, posterPath: media }] } },
	};
	cleanupVideoEvidence(join(f.runtime.directory, "evidence"), [malicious]);
	expect(readFileSync(media, "utf8")).toBe("preserve me");
});

it("requires the selected video contract through result normalization", () => {
	const legacyCapture = { screenshots: [], unavailable: [] };
	expect(validateFactoryResult("capture", legacyCapture)).toEqual(
		legacyCapture,
	);
	for (const step of ["visual-scope", "capture"]) {
		expect(() =>
			validateFactoryResult(step, legacyCapture, undefined, "video-v1"),
		).toThrow();
	}
	const capture = { ...legacyCapture, videoContract: "video-v1" };
	expect(
		validateFactoryResult("capture", capture, undefined, "video-v1"),
	).toEqual(capture);
});
