// F1_AGENT_MODE=mock node apps/f1/test-drives/assets/update-lifecycle.mjs
// Controlled supervisor + candidate fixture; actual WorkflowRuntime, MachineCapacity,
// protected FactoryServer handlers and durable updater. No provider CLI or OS service.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultWorkflows } from "../../../../packages/edge-worker/dist/factory/defaultWorkflows.js";
import { FactoryServer } from "../../../../packages/edge-worker/dist/factory/FactoryServer.js";
import { validateWorkflows } from "../../../../packages/edge-worker/dist/factory/Workflow.js";
import { WorkflowRuntime } from "../../../../packages/edge-worker/dist/factory/WorkflowRuntime.js";
import { MachineCapacity } from "../../../../packages/edge-worker/dist/MachineCapacity.js";
import { UpdateDrain } from "../../../../packages/edge-worker/dist/updates/UpdateDrain.js";
import {
	candidateKey,
	UpdateManager,
} from "../../../../packages/edge-worker/dist/updates/UpdateManager.js";

assert.equal(process.env.F1_AGENT_MODE, "mock");
const home = mkdtempSync(join(tmpdir(), "f1-update-lifecycle-"));
const calls = [],
	nativeResumes = [],
	receipts = [];
let busy = false,
	workers = 1,
	peakWorkers = 1,
	runtime,
	drain,
	server,
	snapshotReceipt,
	failHealth = false;
const capacity = new MachineCapacity(2, join(home, "machine-capacity"));
await capacity.ready();
const hooks = {
	agent: async (ctx) => {
		const sessionId = ctx.resumeAgent?.sessionId ?? `mock-native-${ctx.run.id}`;
		ctx.checkpointAgent?.({ runner: "codex", sessionId });
		nativeResumes.push({
			run: ctx.run.id,
			resumed: ctx.resumeAgent?.sessionId,
		});
		return {
			questions: ctx.run.answers.length
				? []
				: ["Choose the retained fixture answer"],
		};
	},
	script: async () => ({}),
	tool: async () => ({
		headSha: "d".repeat(40),
		url: "https://example.test/review/1",
	}),
};
const createRuntime = () => {
	runtime = new WorkflowRuntime(home, hooks);
	drain = new UpdateDrain(
		home,
		runtime,
		capacity,
		() =>
			busy ||
			[...runtime.runs.values()].some((run) => run.status === "running"),
		() => runtime.resumeAll(),
	);
};
createRuntime();
const definitions = validateWorkflows([
	...defaultWorkflows,
	{
		id: "update-question",
		name: "Update question",
		allowedTriggers: ["manual"],
		steps: [
			{
				id: "clarify",
				name: "Question",
				type: "agent",
				prompt: "Mock",
				askQuestions: true,
				next: "end",
			},
		],
	},
	{
		id: "update-review",
		name: "Update review",
		allowedTriggers: ["manual"],
		steps: [
			{
				id: "review",
				name: "Review",
				type: "tool",
				tool: "human-review",
				next: "end",
			},
		],
	},
]);
const create = (id) =>
	runtime.create({
		id,
		title: id,
		repositoryId: "fixture",
		workspace: home,
		input: "Fixture",
		workflow: definitions.find((workflow) => workflow.id === id),
		triggerOrigin: {
			type: "manual",
			workflowId: id,
			at: new Date().toISOString(),
		},
	});
const question = create("update-question"),
	review = create("update-review");
void runtime.launch(question);
void runtime.launch(review);
const until = async (check) => {
	const end = Date.now() + 10000;
	while (!check()) {
		assert.ok(Date.now() < end, "Mock F1 timeout");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
};
await until(() => question.status === "waiting" && review.status === "waiting");
const questionBatch = question.questionBatchId,
	reviewGate = JSON.parse(JSON.stringify(review.reviewGate)),
	checkpoint = JSON.parse(JSON.stringify(question.checkpoint));
const installed = {
	version: "1.0.0",
	commit: "a".repeat(40),
	target: "darwin-arm64",
};
let candidate = {
	version: "1.1.0-nightly.20261010.100",
	commit: "b".repeat(40),
	channel: "nightly",
	target: "darwin-arm64",
	manifestSha256: "c".repeat(64),
	publishedAt: "2026-10-10T16:00:00.000Z",
};
const source = {
	discover: async () => candidate,
	stage: async (candidate) => ({
		candidate,
		executable: join(home, "mock-new"),
		previousExecutable: join(home, "mock-old"),
	}),
};
const lifecycle = {
	acquireMaintenance: async (id) => {
		calls.push("freeze");
		await drain.begin(id);
	},
	isIdle: async () => (await drain.inspect()).idle,
	preflight: async () => ({ stateCompatible: true }),
	snapshot: async (id) => {
		snapshotReceipt = drain.receipt();
		const path = join(home, "snapshots", id);
		mkdirSync(path, { recursive: true });
		cpSync(join(runtime.directory, "runs"), join(path, "runs"), {
			recursive: true,
		});
		return path;
	},
	stop: async () => {
		calls.push("stop");
		assert.equal((await drain.inspect()).idle, true);
		await runtime.shutdown();
		workers--;
	},
	activate: async () => {
		calls.push("activate");
		assert.equal(workers, 0);
	},
	start: async () => {
		calls.push("start");
		assert.equal(workers, 0);
		createRuntime();
		workers++;
		peakWorkers = Math.max(peakWorkers, workers);
	},
	health: async () => {
		calls.push("health");
		assert.deepEqual(drain.receipt(), snapshotReceipt);
		if (failHealth) throw new Error("Controlled trial health failure");
	},
	rollback: async (transaction) => {
		calls.push("rollback");
		if (workers) {
			await runtime.shutdown();
			workers--;
		}
		cpSync(join(transaction.snapshot, "runs"), join(home, "factory", "runs"), {
			recursive: true,
			force: true,
		});
		createRuntime();
		workers++;
		assert.deepEqual(drain.receipt(), snapshotReceipt);
	},
	releaseMaintenance: async (id) => {
		calls.push("release");
		await drain.end(id);
	},
};
const manager = new UpdateManager(home, source, lifecycle, installed);
const hooksForServer = () => ({
	updates: manager,
	updateDrain: drain,
	capacity,
	repositories: () => [],
	sessions: () => [],
	entries: () => [],
	start: async () => {
		throw new Error("Unexpected launch");
	},
	stop: (id) => runtime.stop(id),
});
server = new FactoryServer(runtime, hooksForServer(), {
	origins: ["http://localhost"],
});
// Controlled authenticated operator fixture; production auth middleware remains enabled.
server.auth.store.update((state) => {
	state.credentials.push({
		id: "f1-update",
		origin: "http://localhost",
		publicKey: "fixture",
		counter: 0,
		label: "F1 mocked operator",
		deviceType: "singleDevice",
		backedUp: false,
		createdAt: Date.now(),
		lastUsedAt: Date.now(),
	});
	state.sessions.push({
		hash: createHash("sha256").update("f1-update-session").digest("hex"),
		credential: "f1-update",
		origin: "http://localhost",
		expires: Date.now() + 3600000,
		verifiedAt: Date.now(),
	});
});
const headers = {
	host: "localhost",
	origin: "http://localhost",
	cookie: "factory-local-session=f1-update-session",
	"x-factory-request": "1",
};
const request = async (path, body, method = "POST") => {
	const response = await server.app.inject({
		method,
		url: path,
		headers,
		payload: body,
	});
	assert.equal(response.statusCode, 200, response.body);
	return response.json();
};
try {
	const protectedResponse = await server.app.inject({
		method: "PUT",
		url: "/api/updates/settings",
		headers: { ...headers, cookie: "" },
		payload: { revision: 0, settings: { channel: "nightly" } },
	});
	assert.equal(protectedResponse.statusCode, 401);
	await request(
		"/api/updates/settings",
		{ revision: 0, settings: { channel: "nightly" } },
		"PUT",
	);
	await request("/api/updates/check", {});
	await request("/api/updates/stage", {});
	busy = true;
	await manager.reconcile();
	assert.deepEqual(calls, ["freeze", "release"]);
	assert.equal(manager.status().pending.candidate.version, candidate.version);
	busy = false;
	receipts.push("busy update postponed without Stop");
	const lease = await capacity.acquireLease(undefined, {
		identity: "f1-controlled-descendant",
	});
	const descendant = spawn(
		process.execPath,
		["-e", "setTimeout(() => {}, 700)"],
		{
			env: {
				PATH: process.env.PATH,
				BOBS_FACTORY_EXECUTION_LEASE: lease.token,
			},
			stdio: "ignore",
		},
	);
	const exit = once(descendant, "exit");
	await manager.reconcile();
	assert.equal(descendant.exitCode, null);
	assert.ok(!calls.includes("stop"));
	const [code, signal] = await exit;
	assert.equal(code, 0);
	assert.equal(signal, null);
	await lease.release();
	receipts.push(
		"active capacity lease/controlled descendant postpones update and exits naturally without a signal",
	);

	const originalPreflight = lifecycle.preflight;
	lifecycle.preflight = async () => {
		const blocked = await server.app.inject({
			method: "POST",
			url: "/api/runs",
			headers,
			payload: {},
		});
		assert.equal(blocked.statusCode, 503);
		new UpdateManager(home).configure({ policy: "manual" }, 1);
		return { stateCompatible: true };
	};
	await manager.reconcile();
	assert.ok(!calls.includes("stop"));
	lifecycle.preflight = originalPreflight;
	receipts.push(
		"authenticated intake freeze and concurrent manual-policy cancellation",
	);
	manager.requestInstall(candidateKey(candidate), 2);
	await manager.reconcile();
	assert.equal(manager.status().transaction.phase, "succeeded");
	assert.equal(peakWorkers, 1);
	await until(
		() =>
			runtime.get(question.id).status === "waiting" &&
			runtime.get(review.id).status === "waiting",
	);
	assert.equal(runtime.get(question.id).questionBatchId, questionBatch);
	assert.deepEqual(runtime.get(review.id).reviewGate, reviewGate);
	assert.deepEqual(runtime.get(question.id).checkpoint, checkpoint);
	assert.deepEqual(runtime.get(question.id).answers, []);
	assert.deepEqual(runtime.get(review.id).humanDecisions ?? [], []);
	receipts.push(
		"single controlled runtime replacement preserves native checkpoint, answer batch, review gate and frozen definitions",
	);
	// A newer candidate fails its trial; rollback restores only run state, never auth or native stores.
	candidate = {
		...candidate,
		version: "1.1.0-nightly.20261010.101",
		manifestSha256: "e".repeat(64),
	};
	await manager.check();
	await manager.stage();
	manager.requestInstall(candidateKey(candidate), 2);
	failHealth = true;
	await manager.reconcile();
	assert.equal(manager.status().transaction.phase, "rolled-back");
	assert.equal(
		manager.status().installed.version,
		"1.1.0-nightly.20261010.100",
	);
	assert.equal(peakWorkers, 1);
	await until(() => runtime.get(question.id).status === "waiting");
	assert.deepEqual(runtime.get(review.id).reviewGate, reviewGate);
	assert.equal(runtime.get(question.id).questionBatchId, questionBatch);
	receipts.push(
		"failed trial rolls back retained runtime/run state without duplicate workers or accepting gates",
	);
	runtime.answer(question.id, "Fixture approved answer");
	await until(() => runtime.get(question.id).status === "completed");
	assert.ok(
		nativeResumes.some(
			(entry) =>
				entry.run === question.id &&
				entry.resumed === `mock-native-${question.id}`,
		),
	);
	receipts.push(
		"answer continuation passes the preserved mock native session ID",
	);
	const foreignHome = mkdtempSync(join(tmpdir(), "f1-update-other-instance-"));
	assert.equal(
		new UpdateManager(foreignHome).status().settings.channel,
		"stable",
	);
	assert.equal(new UpdateManager(foreignHome).status().pending, undefined);
	receipts.push("independent instance settings and candidates");
	const output = {
		mode: "mock",
		testedCommit: process.env.F1_TESTED_COMMIT ?? "working-tree",
		home,
		receipts,
		peakWorkers,
		calls,
		nativeResumes,
		limitations: [
			"Controlled in-process supervisor and candidate, no native OS service restart",
			"No live agents, signatures generated, release publication or production home access",
			"Production service adapter and four-target final candidate native validation are separate evidence",
		],
	};
	const file = join(
		process.env.F1_EVIDENCE_DIR ?? home,
		"update-lifecycle.json",
	);
	writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`);
	console.log(JSON.stringify({ passed: receipts, receipt: file, peakWorkers }));
} finally {
	await server.stop();
	await runtime.shutdown();
	await capacity.shutdown();
}
