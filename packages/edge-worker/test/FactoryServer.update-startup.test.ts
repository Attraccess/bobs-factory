import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { FactoryServer } from "../src/factory/FactoryServer.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import { UpdateManager } from "../src/updates/UpdateManager.js";

vi.mock("bobs-factory-core", async (importOriginal) => ({
	...(await importOriginal<typeof import("bobs-factory-core")>()),
	factoryRuntimeIdentity: {
		version: "1.1.0",
		commit: "b".repeat(40),
		target: "darwin-arm64",
		packaged: true,
	},
}));
const identity = {
	version: "1.1.0",
	commit: "b".repeat(40),
	target: "darwin-arm64",
};
function fixture() {
	const home = mkdtempSync(join(tmpdir(), "factory-startup-observation-"));
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	const updates = new UpdateManager(home, undefined, undefined, {
		...identity,
		version: "1.0.0",
		commit: "a".repeat(40),
	});
	updates.configure({}, 0);
	const server = new FactoryServer(runtime, {
		updates,
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {
			throw new Error("Unused");
		},
		stop: (id) => runtime.stop(id),
	});
	const cleanup = async () => {
		await server.stop();
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	};
	return { home, updates, server, cleanup };
}
it("serves protected API health after an owned starting observation despite a live writer", async () => {
	const { updates, server, cleanup } = fixture();
	const state = JSON.parse(readFileSync(updates.file, "utf8"));
	const candidate = {
		...identity,
		channel: "stable",
		manifestSha256: "c".repeat(64),
		publishedAt: "2026-10-10T18:00:00.000Z",
	};
	state.transaction = {
		id: "startup",
		candidate,
		staged: { candidate, executable: "/new", previousExecutable: "/old" },
		previous: state.installed,
		revision: state.revision,
		phase: "starting",
		switchStarted: true,
		startedAt: new Date().toISOString(),
	};
	writeFileSync(updates.file, JSON.stringify(state));
	const before = readFileSync(updates.file, "utf8");
	const lock = join(updates.directory, "state.lock");
	writeFileSync(lock, String(process.pid), { flag: "wx" });
	try {
		expect(
			(
				await server.app.inject({
					url: "/api/auth/status",
					headers: { host: "localhost:3457" },
				})
			).statusCode,
		).toBe(200);
		expect(
			(
				await server.app.inject({
					url: "/api/updates",
					headers: { host: "localhost:3457" },
				})
			).statusCode,
		).toBe(401);
		expect(readFileSync(updates.file, "utf8")).toBe(before);
		expect(readFileSync(lock, "utf8")).toBe(String(process.pid));
	} finally {
		await cleanup();
	}
});
it("awaits transient observation retry before API readiness", async () => {
	const { updates, server, cleanup } = fixture();
	const lock = join(updates.directory, "state.lock");
	writeFileSync(lock, String(process.pid), { flag: "wx" });
	const release = setTimeout(() => rmSync(lock), 50);
	try {
		expect(
			(
				await server.app.inject({
					url: "/api/auth/status",
					headers: { host: "localhost:3457" },
				})
			).statusCode,
		).toBe(200);
		expect(updates.status().installed).toEqual(identity);
	} finally {
		clearTimeout(release);
		await cleanup();
	}
});
it("keeps genuine updater schema errors visible to startup", async () => {
	const { updates, server, cleanup } = fixture();
	writeFileSync(updates.file, "{}");
	try {
		await expect(server.app.ready()).rejects.toThrow();
	} finally {
		await cleanup();
	}
});
