import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { EdgeWorker } from "../../../../packages/edge-worker/src/EdgeWorker.js";
import {
	defaultWorkflows,
	legacyReviewSteps,
} from "../../../../packages/edge-worker/src/factory/defaultWorkflows.js";
import { WorkflowSchema } from "../../../../packages/edge-worker/src/factory/Workflow.js";
import { workflowRoles } from "../../../../packages/edge-worker/src/factory/WorkflowCatalog.js";
import { f1AgentHandlers } from "../../src/MockAgentRunner.js";

// Real routing, worktrees, native session persistence and protected HTTP API;
// all provider execution is intercepted, including background title jobs.
assert.equal(process.env.F1_AGENT_MODE, "mock");
const directory = mkdtempSync(join(tmpdir(), "f1-catalog-129-"));
const home = join(directory, "home"),
	repo = join(directory, "repository");
mkdirSync(join(home, "factory"), { recursive: true });
mkdirSync(repo);
const git = (...args: string[]) =>
	execFileSync("git", args, { cwd: repo, encoding: "utf8" });
git("init", "-b", "main");
git("config", "user.email", "f1@example.test");
git("config", "user.name", "F1");
writeFileSync(join(repo, "README.md"), "Catalog F1 fixture\n");
git("add", ".");
git("commit", "-m", "Fixture");
const legacy = structuredClone(defaultWorkflows).map((w) =>
	w.id === "factory-pipeline"
		? { ...w, steps: structuredClone(legacyReviewSteps) }
		: w,
);
Object.assign(
	legacy
		.find((w) => w.id === "factory-pipeline")!
		.steps.find((s) => s.id === "code-review"),
	{ runner: "codex", model: "gpt-6.1-sol", reasoningEffort: "high" },
);
if (process.env.F1_CAPTURE_MIGRATION === "1")
	legacy.find((w) => w.id === "simple")!.description =
		"Customized native behavior from a legacy installation";
const original = JSON.stringify({
	workflows: legacy,
	defaultWorkflow: "simple",
});
writeFileSync(join(home, "factory", "workflows.json"), original);
process.env.BOBS_FACTORY_FACTORY_PORT = "3649";
process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY = join(
	directory,
	"legacy-capacity",
);
const observed: any[] = [];
const inputs: string[] = [];
let holdNative = false,
	nativeStarted = false;
const mocks = f1AgentHandlers(
	"mock",
	JSON.stringify({
		status: "completed",
		summary: "Mock catalog role",
		checks: [],
		questions: [],
	}),
)!;
const options: any = {
	platform: "cli",
	factoryHome: home,
	serverPort: 3650,
	serverHost: "127.0.0.1",
	defaultRunner: "codex",
	maxConcurrentSessions: 1,
	handlers: {
		...mocks,
		createAgentRunner: (type: any, config: any) => {
			observed.push({
				type,
				model: config.model,
				resume: config.resumeSessionId,
				workingDirectory: config.workingDirectory,
			});
			let release: (() => void) | undefined;
			const holding =
				holdNative && !config.workingDirectory?.includes("title-jobs");
			const runner = mocks.createAgentRunner!(
				type,
				holding
					? {
							...config,
							onMessage: async (message: any) => {
								await config.onMessage?.(message);
								if (message.type === "system" && message.subtype === "init") {
									nativeStarted = true;
									await new Promise<void>((resolve) => (release = resolve));
								}
							},
						}
					: config,
			);
			if (holding) {
				const stop = runner.stop.bind(runner);
				runner.stop = () => {
					stop();
					release?.();
				};
			}
			const start = runner.start.bind(runner);
			runner.start = async (prompt: string) => {
				inputs.push(prompt);
				return start(prompt);
			};
			Object.defineProperty(runner, "constructor", {
				value: { name: type === "codex" ? "CodexRunner" : "ClaudeRunner" },
			});
			return runner;
		},
	},
	repositories: [
		{
			id: "repo",
			name: "Catalog fixture",
			repositoryPath: repo,
			baseBranch: "main",
			workspaceBaseDir: join(directory, "worktrees"),
			linearWorkspaceId: "cli-workspace",
			isActive: true,
		},
	],
};
let worker = new EdgeWorker(options),
	internal = worker as any,
	runtime = internal.getFactoryRuntime();
const until = async (
	check: () => boolean | Promise<boolean>,
	label: string,
) => {
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		if (await check()) return;
		await new Promise((r) => setTimeout(r, 50));
	}
	throw new Error(`Timed out: ${label}`);
};
const api = async (
	path: string,
	method = "GET",
	body?: unknown,
	expected = 200,
) => {
	const r = await fetch(`http://localhost:3649${path}`, {
		method,
		headers: {
			origin: "http://localhost:3649",
			cookie: "factory-local-session=f1-catalog-session",
			"content-type": "application/json",
			"x-factory-request": "1",
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const data = (await r.json()) as any;
	assert.equal(r.status, expected, JSON.stringify(data));
	return data;
};
const seed = () =>
	internal.factoryServer.auth.store.update((s: any) => {
		s.credentials.push({
			id: "drive",
			origin: "http://localhost:3649",
			publicKey: "fixture",
			counter: 0,
			label: "F1",
			deviceType: "singleDevice",
			backedUp: false,
			createdAt: Date.now(),
			lastUsedAt: Date.now(),
		});
		s.sessions.push({
			hash: createHash("sha256").update("f1-catalog-session").digest("hex"),
			credential: "drive",
			origin: "http://localhost:3649",
			expires: Date.now() + 3600000,
			verifiedAt: Date.now(),
		});
	});
const disable = async (id: string) => {
	const impact = await api(`/api/workflows/${id}/availability`);
	await api(`/api/workflows/${id}/availability`, "PUT", {
		enabled: false,
		confirm: true,
		token: impact.token,
	});
	return impact;
};
const enable = (id: string) =>
	api(`/api/workflows/${id}/availability`, "PUT", { enabled: true });
const rpc = async (method: string, params: unknown) => {
	const r = await fetch("http://localhost:3650/cli/rpc", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
	});
	const v = (await r.json()) as any;
	assert(!v.error, JSON.stringify(v));
	return v.result;
};
let started = false;
try {
	await worker.start();
	started = true;
	seed();
	if (process.env.F1_CAPTURE_MIGRATION === "1") {
		const configuration = runtime.catalog.read();
		configuration.preferences["factory-pipeline"]["retired-reviewer"] = {
			runner: "codex",
			model: "old-model",
		};
		await worker.stop();
		started = false;
		writeFileSync(
			join(home, "factory", "workflows.json"),
			JSON.stringify(configuration),
		);
		worker = new EdgeWorker(options);
		internal = worker as any;
		runtime = internal.getFactoryRuntime();
		await worker.start();
		started = true;
		assert(runtime.catalog.read().migration.conflicts.simple);
		assert.equal(runtime.catalog.read().inactive.length, 1);
		await api(
			"/api/runs",
			"POST",
			{
				repositoryId: "repo",
				workflow: "simple",
				prompt: "Conflict must reject",
			},
			409,
		);
		console.log(
			"F1_MIGRATION_READY http://localhost:3649 unknown Simple behavior blocked; retired role preference retained visibly",
		);
	} else {
		const migrated = runtime.catalog.read();
		assert.equal(readFileSync(migrated.migration.backup, "utf8"), original);
		assert.equal(migrated.locals.length, 0);
		const pipeline = runtime
			.listWorkflows()
			.find((w: any) => w.id === "factory-pipeline");
		const roles = workflowRoles(pipeline.steps).filter((r) =>
			r.role.startsWith("specialist-review/"),
		);
		assert.equal(roles.length, 6);
		for (const { step } of roles) assert.equal(step.model, "gpt-6.1-sol");
		assert(
			pipeline.steps.some((s: any) => s.reviewContract === "inventory-v1"),
		);
		assert.equal(
			pipeline.steps.find((s: any) => s.id === "guide").guideContract,
			"brief-v1",
		);
		await api("/api/workflows/simple/fork", "POST", {}, 409);
		const one = await api("/api/workflows/factory/fork", "POST", {
				name: "Editable Factory",
			}),
			two = await api("/api/workflows/factory/fork", "POST", {
				name: "Second Factory",
			});
		// Fork endpoint returns the copied root directly.
		const first = one.workflow ?? one,
			second = two.workflow ?? two;
		assert.notEqual(first.id, second.id);
		const definitions = runtime.listWorkflows();
		const child = definitions.find(
			(w: any) => w.id === first.steps[0].workflow,
		);
		child.steps[0].prompt = "Isolated fork prompt";
		await api("/api/workflows", "PUT", {
			workflows: definitions,
			defaultWorkflow: "simple",
		});
		assert.notEqual(
			runtime
				.listWorkflows()
				.find((w: any) => w.id === second.steps[0].workflow).steps[0].prompt,
			child.steps[0].prompt,
		);
		await disable("factory-pipeline");
		assert.throws(
			() => runtime.selectWorkflow([], "manual", "factory"),
			/unavailable/,
		);
		assert.equal(runtime.selectWorkflow([], "manual", first.id).id, first.id);
		await enable("factory-pipeline");
		console.log(
			"PASS exact-byte stock migration, six-role overlays, reserved Simple, private fork isolation and dependency launch gating",
		);
		await api("/api/workflows/simple/preferences", "PUT", {
			native: { modelVariant: "fixture-variant" },
		});
		const beforeRejectedLaunch = runtime.runs.size;
		await api(
			"/api/runs",
			"POST",
			{
				repositoryId: "repo",
				workflow: "simple",
				prompt: "Invalid inherited variant",
			},
			409,
		);
		assert.equal(runtime.runs.size, beforeRejectedLaunch);
		await api("/api/workflows/simple/preferences", "PUT", { native: {} });
		console.log(
			"PASS incompatible inherited native preferences reject before setup",
		);
		const waiting = WorkflowSchema.parse({
			id: "catalog-wait",
			name: "Saved question",
			steps: [
				{
					id: "prepare",
					name: "Record progress",
					type: "script",
					script: 'node -e \'process.stdout.write("{\\"saved\\":true}")\'',
				},
				{
					id: "question",
					name: "Question",
					type: "agent",
					prompt: "Fixture",
					askQuestions: true,
				},
			],
		});
		// Deterministic runtime agent hook for a persisted human checkpoint.
		runtime.hooks.agent = async () => ({
			questions: ["Choose the next implementation option"],
		});
		runtime.updateWorkflows([...runtime.listWorkflows(), waiting]);
		const queued = await api(
			"/api/runs",
			"POST",
			{
				repositoryId: "repo",
				workflow: waiting.id,
				prompt: "Keep saved progress",
			},
			202,
		);
		await until(() => runtime.get(queued.id).status === "waiting", "question");
		const frozen = structuredClone(runtime.get(queued.id).workflow),
			history = structuredClone(runtime.get(queued.id).history);
		await disable(waiting.id);
		assert.equal(runtime.get(queued.id).status, "blocked");
		await enable(waiting.id);
		assert.equal(runtime.get(queued.id).status, "blocked");
		await worker.stop();
		started = false;
		worker = new EdgeWorker(options);
		internal = worker as any;
		runtime = internal.getFactoryRuntime();
		await worker.start();
		started = true;
		assert.equal(runtime.get(queued.id).status, "blocked");
		assert.deepEqual(runtime.get(queued.id).workflow, frozen);
		assert.deepEqual(runtime.get(queued.id).history, history);
		await api(`/api/runs/${queued.id}/resume`, "POST", {}, 202);
		await until(
			() => runtime.get(queued.id).status === "waiting",
			"restored question",
		);
		assert.equal(
			runtime.get(queued.id).questions[0],
			"Choose the next implementation option",
		);
		// Queue native Simple after its first turn, so there is an existing conversation to preserve.
		const issue = await rpc("createIssue", {
			teamId: "team-default",
			title: "Native catalog continuation",
			description: "[workflow=simple] Inspect repository",
		});
		const assigned = await rpc("startSession", { issueId: issue.issue.id }),
			nativeId = assigned.session.sessionId;
		await until(
			() =>
				!!internal.agentSessionManager.getSession(nativeId)?.codexSessionId &&
				!internal.agentSessionManager
					.getSession(nativeId)
					?.agentRunner?.isRunning(),
			"first native turn",
		);
		const native = internal.agentSessionManager.getSession(nativeId),
			thread = native.codexSessionId;
		await until(
			async () => (await internal.runnerSlots.snapshot()).active === 0,
			"idle title and native",
		);
		const blocker = await internal.runnerSlots.acquireLease();
		await rpc("promptSession", {
			sessionId: nativeId,
			message: "Continue the same conversation",
		});
		await until(
			async () => (await internal.runnerSlots.snapshot()).queued > 0,
			"queued native continuation",
		);
		const impact = await disable("simple");
		assert(impact.runs.includes(nativeId));
		assert(runtime.catalog.getBlock(nativeId));
		await until(
			async () =>
				!(await internal.runnerSlots.snapshot()).requests.some(
					(r: any) => r.identity === `${home}:session:${nativeId}`,
				),
			"native queue cancelled",
		);
		await blocker.release();
		assert.equal(native.codexSessionId, thread);
		await enable("simple");
		assert(runtime.catalog.getBlock(nativeId));
		await api(`/api/runs/${nativeId}/resume`, "POST", {}, 202);
		await until(
			() =>
				!native.agentRunner?.isRunning() && !runtime.catalog.getBlock(nativeId),
			"native individual resume",
		);
		assert.equal(native.codexSessionId, thread);
		assert(observed.some((o) => o.resume === thread));
		assert(
			inputs.some((prompt) =>
				prompt.includes("Continue the same conversation"),
			),
		);
		holdNative = true;
		nativeStarted = false;
		await rpc("promptSession", {
			sessionId: nativeId,
			message: "Active interrupted turn",
		});
		await until(
			() => nativeStarted && native.agentRunner?.isRunning(),
			"active native turn",
		);
		await disable("simple");
		holdNative = false;
		await until(
			async () =>
				!native.agentRunner?.isRunning() &&
				(await internal.runnerSlots.snapshot()).active === 0,
			"active native stopped and capacity released",
		);
		assert.equal(native.codexSessionId, thread);
		assert(runtime.catalog.getBlock(nativeId));
		await enable("simple");
		await api(`/api/runs/${nativeId}/resume`, "POST", {}, 202);
		assert.equal(native.codexSessionId, thread);
		assert(
			inputs.filter((prompt) => prompt.includes("Active interrupted turn"))
				.length >= 2,
		);
		console.log(
			"PASS active native interruption, confirmed stop and same-conversation Resume",
		);
		const timeline = await rpc("viewSession", {
			sessionId: nativeId,
			limit: 100,
			offset: 0,
		});
		assert(timeline.totalCount > 0);
		console.log(
			"PASS persisted blocked checkpoint, restart without auto-resume, retained question, queued native Simple interruption and individual conversation resume",
		);
		// Leave a blocked run for browser evidence; another enabled recipe remains launchable.
		await disable(waiting.id);
		const exported = await api("/api/workflows/export");
		const importImpact = await api(
			"/api/workflows/import/impact",
			"POST",
			exported,
		);
		await api("/api/workflows/import", "POST", {
			configuration: exported,
			confirm: true,
			token: importImpact.token,
		});
		console.log("PASS protected export/import round trip");
		const receiptPath =
			process.env.F1_RECEIPT_PATH ?? "node_modules/.cache/f1-catalog-129.json";
		mkdirSync(dirname(receiptPath), { recursive: true });
		writeFileSync(
			receiptPath,
			JSON.stringify(
				{
					mode: "mock",
					result: "passed",
					runId: queued.id,
					nativeId,
					home,
					checks: [
						"migration",
						"forks",
						"dependency gating",
						"blocked restart",
						"native queue interruption",
						"native Resume",
						"HTTP import/export",
					],
				},
				null,
				2,
			),
		);
		console.log(`F1_READY http://localhost:3649 run=${queued.id}`);
	}
	if (process.env.F1_CAPTURE_WAIT === "1")
		await new Promise<void>((resolve) => {
			process.once("SIGINT", () => resolve());
			process.once("SIGTERM", () => resolve());
		});
} finally {
	if (started) await worker.stop();
	else await runtime.shutdown();
	rmSync(directory, { recursive: true, force: true });
}
