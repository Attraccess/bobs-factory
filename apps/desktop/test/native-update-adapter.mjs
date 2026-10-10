// Native runtime replacement/rollback smoke; unsigned local candidates only.
// node ... OLD_RUNTIME_DIRECTORY NEW_RUNTIME_DIRECTORY
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultWorkflows } from "../../../packages/edge-worker/dist/factory/defaultWorkflows.js";
import { validateWorkflows } from "../../../packages/edge-worker/dist/factory/Workflow.js";
import { WorkflowRuntime } from "../../../packages/edge-worker/dist/factory/WorkflowRuntime.js";
import { UpdateManager } from "../../../packages/edge-worker/dist/updates/UpdateManager.js";
import { localRepository } from "../../cli/dist/src/onboarding.js";
import { workerOwner } from "../../cli/dist/src/services/InstanceLock.js";
import { OwnedUpdateLifecycle } from "../../cli/dist/src/services/OwnedUpdateLifecycle.js";
import { runUpdateSupervisor } from "../../cli/dist/src/services/UpdateSupervisor.js";
import { desktopExecutable } from "../src/local-runtime.mjs";

const [oldDirectory, newDirectory] = process.argv.slice(2);
assert(oldDirectory && newDirectory);
const previous = JSON.parse(
	readFileSync(join(oldDirectory, "build.json"), "utf8"),
);
const next = JSON.parse(readFileSync(join(newDirectory, "build.json"), "utf8"));
assert.equal(previous.dirty, false);
assert.equal(next.dirty, false);
const candidate = {
	...next,
	channel: "nightly",
	manifestSha256: createHash("sha256")
		.update("local-mocked-source")
		.digest("hex"),
	publishedAt: new Date().toISOString(),
};
const receipts = [];
const crashChild = process.env.FACTORY_NATIVE_CRASH_HOME;
for (const mode of crashChild
	? ["success"]
	: ["success", "failed-health", "lost-release-ack"]) {
	if (
		!crashChild &&
		process.env.FACTORY_NATIVE_TEST_MODE &&
		process.env.FACTORY_NATIVE_TEST_MODE !== mode
	)
		continue;
	const failHealth = mode === "failed-health";
	const failReleaseAck = mode === "lost-release-ack";
	const home = realpathSync(
		crashChild ?? mkdtempSync(join(tmpdir(), "factory-native-update-")),
	);
	const port = crashChild
		? 19465
		: failReleaseAck
			? 19467
			: failHealth
				? 19463
				: 19461;
	const link = desktopExecutable(home, oldDirectory);
	const repo = join(home, "repo");
	mkdirSync(repo);
	execFileSync("git", ["init", "-q", "-b", "main", repo]);
	execFileSync("git", [
		"-C",
		repo,
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@example.invalid",
		"commit",
		"--allow-empty",
		"-qm",
		"Mock fixture",
	]);
	execFileSync("git", [
		"-C",
		repo,
		"remote",
		"add",
		"origin",
		"https://github.com/example/native-fixture.git",
	]);
	writeFileSync(
		join(home, "config.json"),
		JSON.stringify({ repositories: [localRepository(repo, home, "fixture")] }),
		{ mode: 0o600 },
	);

	let activations = 0;
	let releaseAckLost = false;
	class Lifecycle extends OwnedUpdateLifecycle {
		async activate(staged) {
			activations++;
			await super.activate(staged);
			if (crashChild) process.exit(73);
		}
		async releaseMaintenance(id, outcome) {
			await super.releaseMaintenance(id, outcome);
			if (
				failReleaseAck &&
				!releaseAckLost &&
				realpathSync(link) === realpathSync(join(newDirectory, "bobs-factory"))
			) {
				releaseAckLost = true;
				throw Error(
					"Injected lost acknowledgment after real maintenance release",
				);
			}
		}
		async health(identity) {
			if (failHealth && identity.version === next.version)
				throw new Error("Injected replacement health failure");
			return super.health(identity);
		}
	}
	let mockCalls = 0;
	const runtime = new WorkflowRuntime(home, {
		agent: async (ctx) => {
			mockCalls++;
			ctx.checkpointAgent?.({
				sessionId: "mock-native-update-conversation",
				runner: "codex",
				cwd: home,
			});
			return { questions: ["Choose a color"] };
		},
		script: async () => {
			throw Error("Unexpected script");
		},
		tool: async () => {
			throw Error("Unexpected tool");
		},
	});
	const workflow = validateWorkflows([
		...defaultWorkflows,
		{
			id: "native-update-fixture",
			name: "Native update fixture",
			entry: "question",
			steps: [
				{
					id: "question",
					name: "Mock question",
					type: "agent",
					prompt: "Mock only",
					askQuestions: true,
				},
			],
		},
	]).at(-1);
	const run = runtime.create({
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
		title: "Preserve waiting question",
		repositoryId: "fixture",
		workspace: repo,
		input: "Mock only",
		workflow,
	});
	void runtime.launch(run);
	for (let n = 0; runtime.get(run.id).status !== "waiting" && n < 100; n++)
		await new Promise((r) => setTimeout(r, 10));
	assert.equal(runtime.get(run.id).status, "waiting");
	assert.equal(mockCalls, 1);
	let preserved = JSON.parse(JSON.stringify(runtime.get(run.id)));

	const lifecycle = new Lifecycle(home, port);
	const source = {
		discover: async () => candidate,
		stage: async () => ({
			candidate,
			executable: realpathSync(join(newDirectory, "bobs-factory")),
			previousExecutable: realpathSync(link),
		}),
	};
	const manager = new UpdateManager(home, source, lifecycle, previous);
	try {
		await lifecycle.start();
		for (let n = 0; n < 100; n++) {
			try {
				if ((await fetch(`http://localhost:${port}/api/auth/status`)).ok) break;
			} catch {}
			await new Promise((r) => setTimeout(r, 200));
		}
		await new Promise((r) => setTimeout(r, 500));
		preserved = JSON.parse(
			readFileSync(join(home, "factory", "runs", `${run.id}.json`), "utf8"),
		);
		assert.equal(preserved.status, "waiting");
		assert(workerOwner(home));
		const nativeMarker = join(
			home,
			"factory",
			"auth",
			"native-preservation-marker",
		);
		writeFileSync(nativeMarker, "mock credential boundary");
		manager.configure(
			{ channel: "nightly", policy: "idle-auto" },
			manager.status().revision,
		);
		await manager.check();
		await manager.stage();
		let result = await manager.reconcile();
		for (
			let attempt = 0;
			result.transaction.phase === "cancelled" &&
			result.transaction.error?.startsWith("Waiting for active work") &&
			attempt < 20;
			attempt++
		) {
			await new Promise((r) => setTimeout(r, 200));
			result = await manager.reconcile();
		}
		if (failReleaseAck) {
			assert.equal(result.transaction.phase, "recovery-required");
			assert.equal(result.transaction.release.outcome, "succeeded");
			assert.equal(result.transaction.release.status, "pending");
			const activatedOwner = workerOwner(home);
			const fresh = new UpdateManager(
				home,
				source,
				new OwnedUpdateLifecycle(home, port),
				previous,
			);
			result = await fresh.recover("operation owner stopped");
			assert.equal(result.transaction.release.status, "acknowledged");
			assert.equal(workerOwner(home).pid, activatedOwner.pid);
			assert.equal(activations, 1);
		}
		assert.equal(
			result.transaction.phase,
			failHealth ? "rolled-back" : "succeeded",
			JSON.stringify(result.transaction),
		);
		assert.equal(
			realpathSync(link),
			failHealth
				? result.transaction.staged.previousExecutable
				: realpathSync(join(newDirectory, "bobs-factory")),
		);
		assert.equal(
			readFileSync(nativeMarker, "utf8"),
			"mock credential boundary",
		);
		const restored = new WorkflowRuntime(home, {
			agent: async () => {
				throw Error("Real agent forbidden");
			},
			script: async () => {
				throw Error("Unexpected script");
			},
			tool: async () => {
				throw Error("Unexpected tool");
			},
		}).get(run.id);
		for (const key of [
			"status",
			"workflow",
			"workflowDefinitions",
			"checkpoint",
			"outputs",
			"questions",
			"questionBatchId",
			"answers",
			"reviewGate",
		])
			assert.deepEqual(restored[key], preserved[key], `Preserve ${key}`);

		assert(workerOwner(home));
		await new OwnedUpdateLifecycle(home, port).releaseMaintenance(
			result.transaction.id,
		);
		const crashed = workerOwner(home);
		process.kill(crashed.pid, "SIGKILL");
		await new Promise((r) => setTimeout(r, 200));
		await runUpdateSupervisor(home, port, true);
		for (
			let n = 0;
			(!workerOwner(home) || workerOwner(home).pid === crashed.pid) && n < 100;
			n++
		)
			await new Promise((r) => setTimeout(r, 100));
		assert.notEqual(workerOwner(home)?.pid, crashed.pid);
		receipts.push({
			home,
			port,
			phase: result.transaction.phase,
			mode,
			release: result.transaction.release,
			preservedRunId: run.id,
			mockedAgentCalls: mockCalls,
			previous: previous.version,
			candidate: next.version,
			installed: result.installed.version,
			owner: workerOwner(home),
			snapshot: result.transaction.snapshot,
		});
	} finally {
		// This fixture only stops its own isolated native worker.
		const owner = workerOwner(home);
		if (owner) {
			process.kill(owner.pid, "SIGTERM");
			for (let n = 0; workerOwner(home) && n < 100; n++)
				await new Promise((r) => setTimeout(r, 100));
		}
	}
}
if (!crashChild && !process.env.FACTORY_NATIVE_TEST_MODE) {
	const home = realpathSync(
		mkdtempSync(join(tmpdir(), "factory-native-update-crash-")),
	);
	try {
		execFileSync(
			process.execPath,
			[fileURLToPath(import.meta.url), oldDirectory, newDirectory],
			{
				env: { ...process.env, FACTORY_NATIVE_CRASH_HOME: home },
				stdio: "pipe",
			},
		);
		assert.fail("Expected stopped supervisor");
	} catch (error) {
		assert.equal(error.status, 73);
	}
	try {
		const result = await runUpdateSupervisor(home, 19465, true);
		assert.equal(
			result.transaction.phase,
			"rolled-back",
			JSON.stringify(result.transaction),
		);
		assert.equal(result.installed.version, previous.version);
		assert(workerOwner(home));
		receipts.push({
			home,
			port: 19465,
			phase: result.transaction.phase,
			assertion:
				"external supervisor crash after link activation recovers without worker API",
		});
	} finally {
		const owner = workerOwner(home);
		if (owner) {
			process.kill(owner.pid, "SIGTERM");
			for (let n = 0; workerOwner(home) && n < 100; n++)
				await new Promise((r) => setTimeout(r, 100));
		}
	}
}
console.log(
	JSON.stringify(
		{
			passed: true,
			mode: "unsigned native/runtime; mocked release source and injected health failure",
			receipts,
		},
		null,
		2,
	),
);
