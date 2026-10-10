// Native runtime replacement/rollback smoke; unsigned local candidates only.
// node ... OLD_RUNTIME_DIRECTORY NEW_RUNTIME_DIRECTORY
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdtempSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { UpdateManager } from "../../../packages/edge-worker/dist/updates/UpdateManager.js";
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
for (const failHealth of crashChild ? [false] : [false, true]) {
	const home = realpathSync(
		crashChild ?? mkdtempSync(join(tmpdir(), "factory-native-update-")),
	);
	const port = crashChild ? 19465 : failHealth ? 19463 : 19461;
	const link = desktopExecutable(home, oldDirectory);
	class Lifecycle extends OwnedUpdateLifecycle {
		async activate(staged) {
			await super.activate(staged);
			if (crashChild) process.exit(73);
		}
		async health(identity) {
			if (failHealth && identity.version === next.version)
				throw new Error("Injected replacement health failure");
			return super.health(identity);
		}
	}
	const lifecycle = new Lifecycle(home, port);
	const source = {
		discover: async () => candidate,
		stage: async () => ({
			candidate,
			executable: join(newDirectory, "bobs-factory"),
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
		const result = await manager.reconcile();
		assert.equal(
			result.transaction.phase,
			failHealth ? "rolled-back" : "succeeded",
			JSON.stringify(result.transaction),
		);
		assert.equal(
			realpathSync(link),
			failHealth
				? result.transaction.staged.previousExecutable
				: join(newDirectory, "bobs-factory"),
		);
		assert.equal(
			readFileSync(nativeMarker, "utf8"),
			"mock credential boundary",
		);
		assert(workerOwner(home));
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
if (!crashChild) {
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
