import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
	candidateKey,
	type InstalledUpdate,
	type UpdateCandidate,
	type UpdateLifecycle,
	UpdateManager,
	type UpdateSource,
} from "../src/updates/UpdateManager.js";

const homes: string[] = [];
afterEach(() => {
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
const installed: InstalledUpdate = {
	version: "1.0.0",
	commit: "a".repeat(40),
	target: "darwin-arm64",
};
const candidate: UpdateCandidate = {
	version: "1.1.0-nightly.20261010.100",
	commit: "b".repeat(40),
	channel: "nightly",
	target: "darwin-arm64",
	manifestSha256: "c".repeat(64),
	publishedAt: "2026-10-10T16:00:00.000Z",
};
function fixture(value = candidate) {
	const home = mkdtempSync(join(tmpdir(), "factory-update-test-"));
	homes.push(home);
	const source: UpdateSource = {
		discover: vi.fn(async () => value),
		stage: vi.fn(async (current) => ({
			candidate: current,
			executable: "/isolated/new",
			previousExecutable: "/isolated/old",
		})),
	};
	const calls: string[] = [];
	const lifecycle: UpdateLifecycle = {
		acquireMaintenance: vi.fn(async () => {
			calls.push("maintenance");
		}),
		isIdle: vi.fn(async () => true),
		preflight: vi.fn(async () => ({ stateCompatible: true })),
		snapshot: vi.fn(async () => "/isolated/snapshot"),
		stop: vi.fn(async () => {
			calls.push("stop");
		}),
		activate: vi.fn(async () => {
			calls.push("activate");
		}),
		start: vi.fn(async () => {
			calls.push("start");
		}),
		health: vi.fn(async () => {
			calls.push("health");
		}),
		rollback: vi.fn(async () => {
			calls.push("rollback");
		}),
		releaseMaintenance: vi.fn(async () => {
			calls.push("release");
		}),
	};
	const manager = new UpdateManager(home, source, lifecycle, installed);
	return { home, manager, source, lifecycle, calls };
}
it("persists per-channel choices, defaults, pin and pause independently per home", () => {
	const { home, manager } = fixture();
	expect(manager.status().effectivePolicy).toBe("manual");
	manager.configure({ channel: "nightly" }, 0);
	expect(manager.status().effectivePolicy).toBe("idle-auto");
	manager.configure(
		{ policy: "manual", pin: candidate.version, paused: true },
		1,
	);
	const restarted = new UpdateManager(home);
	expect(restarted.status().settings).toEqual(manager.status().settings);
	restarted.configure({ channel: "stable", policy: "idle-auto" }, 2);
	restarted.configure({ channel: "nightly", pin: null, paused: false }, 3);
	expect(restarted.status().effectivePolicy).toBe("manual");
	expect(fixture().manager.status().settings).toEqual({
		channel: "stable",
		overrides: {},
		paused: false,
	});
});
it("nightly auto installs only after safe drain; manual stable needs candidate-bound consent", async () => {
	const { manager, calls } = fixture();
	manager.configure({ channel: "nightly" }, 0);
	await manager.check();
	await manager.stage();
	await manager.reconcile();
	expect(calls).toEqual([
		"maintenance",
		"stop",
		"activate",
		"start",
		"health",
		"release",
	]);
	expect(manager.status().installed.version).toBe(candidate.version);
	const stable = fixture({ ...candidate, channel: "stable", version: "1.1.0" });
	await stable.manager.check();
	await stable.manager.stage();
	await stable.manager.reconcile();
	expect(stable.calls).toEqual([]);
	const status = stable.manager.status();
	stable.manager.requestInstall(
		candidateKey(status.pending!.candidate),
		status.revision,
	);
	await stable.manager.reconcile();
	expect(stable.calls).toContain("activate");
});
it("manual nightly override, stable auto override, pause and pin share the same gate", async () => {
	for (const settings of [
		{ channel: "nightly" as const, policy: "manual" as const },
		{ channel: "nightly" as const, paused: true },
		{ channel: "nightly" as const, pin: candidate.version },
	]) {
		const { manager, calls } = fixture();
		manager.configure(settings, 0);
		await manager.check();
		await manager.stage();
		await manager.reconcile();
		expect(calls).toEqual([]);
	}
	const stable = fixture({ ...candidate, channel: "stable", version: "1.1.0" });
	stable.manager.configure({ policy: "idle-auto" }, 0);
	await stable.manager.check();
	await stable.manager.stage();
	await stable.manager.reconcile();
	expect(stable.calls).toContain("activate");
});
it("explicit Install while busy remains pending without stopping active work", async () => {
	const { manager, lifecycle, calls } = fixture();
	manager.configure({ channel: "nightly", policy: "manual" }, 0);
	await manager.check();
	await manager.stage();
	manager.requestInstall(candidateKey(candidate), 1);
	vi.mocked(lifecycle.isIdle).mockResolvedValue(false);
	await manager.reconcile();
	expect(calls).toEqual(["maintenance", "release"]);
	expect(manager.status().pending?.consentRevision).toBe(1);
	vi.mocked(lifecycle.isIdle).mockResolvedValue(true);
	await manager.reconcile();
	expect(calls).toContain("activate");
});
it("a second process policy save during preflight cancels queued automatic activation", async () => {
	const { home, manager, lifecycle, calls } = fixture();
	manager.configure({ channel: "nightly" }, 0);
	await manager.check();
	await manager.stage();
	vi.mocked(lifecycle.preflight).mockImplementation(async () => {
		new UpdateManager(home).configure({ policy: "manual" }, 1);
		return { stateCompatible: true };
	});
	await manager.reconcile();
	expect(calls).toEqual(["maintenance", "release"]);
	expect(manager.status().transaction?.phase).toBe("cancelled");
});
it("consent cannot survive pin/pause/policy/channel changes or a newly coalesced candidate", async () => {
	const { manager, source } = fixture();
	manager.configure({ channel: "nightly", policy: "manual" }, 0);
	await manager.check();
	manager.requestInstall(candidateKey(candidate), 1);
	manager.configure({ paused: true }, 1);
	expect(manager.status().pending?.consentRevision).toBeUndefined();
	manager.configure({ paused: false }, 2);
	manager.requestInstall(candidateKey(candidate), 3);
	vi.mocked(source.discover).mockResolvedValue({
		...candidate,
		version: "1.1.0-nightly.20261010.101",
		manifestSha256: "d".repeat(64),
	});
	await manager.check();
	expect(manager.status().pending?.consentRevision).toBeUndefined();
	expect(() => manager.requestInstall(candidateKey(candidate), 3)).toThrow(
		"changed",
	);
	manager.configure({ channel: "stable" }, 3);
	expect(manager.status().pending).toBeUndefined();
});
it("serializes concurrent activation and restores the previous worker after failed trial", async () => {
	const { home, manager, lifecycle, calls } = fixture();
	manager.configure({ channel: "nightly" }, 0);
	await manager.check();
	await manager.stage();
	let release!: () => void;
	const hold = new Promise<void>((resolve) => {
		release = resolve;
	});
	vi.mocked(lifecycle.isIdle).mockImplementation(async () => {
		await hold;
		return true;
	});
	const active = manager.reconcile();
	await vi.waitFor(() => expect(lifecycle.isIdle).toHaveBeenCalled());
	await expect(
		new UpdateManager(home, undefined, lifecycle).reconcile(),
	).rejects.toThrow("owns");
	release();
	vi.mocked(lifecycle.health).mockImplementation(async () => {
		calls.push("health");
		throw new Error("Wrong runtime identity");
	});
	await active;
	expect(calls).toEqual([
		"maintenance",
		"stop",
		"activate",
		"start",
		"health",
		"rollback",
		"release",
	]);
	expect(manager.status().installed).toEqual(installed);
	expect(manager.status().badCandidates).toContain(candidateKey(candidate));
	await manager.reconcile();
	expect(calls.filter((call) => call === "activate")).toHaveLength(1);
});
it("failed rollback retains maintenance and durable recovery rather than starting another worker", async () => {
	const { manager, lifecycle, calls } = fixture();
	manager.configure({ channel: "nightly" }, 0);
	await manager.check();
	await manager.stage();
	vi.mocked(lifecycle.health).mockRejectedValue(new Error("health"));
	vi.mocked(lifecycle.rollback).mockRejectedValue(
		new Error("descendants alive"),
	);
	await manager.reconcile();
	expect(manager.status().transaction?.phase).toBe("recovery-required");
	expect(calls).not.toContain("release");
	await expect(manager.reconcile()).rejects.toThrow("recovery");
});
it("reboot recovery rolls back an interrupted switch and rejects a still-live owner", async () => {
	const { home, manager, lifecycle, calls } = fixture();
	manager.configure({ channel: "nightly" }, 0);
	await manager.check();
	await manager.stage();
	await manager.reconcile();
	const state = JSON.parse(readFileSync(manager.file, "utf8"));
	state.transaction.phase = "starting";
	state.transaction.switchStarted = true;
	state.installed = installed;
	writeFileSync(manager.file, JSON.stringify(state));
	writeFileSync(
		join(manager.directory, "operation.lock"),
		JSON.stringify({ pid: process.pid }),
	);
	await expect(manager.recover("operation owner stopped")).rejects.toThrow(
		"still running",
	);
	rmSync(join(manager.directory, "operation.lock"));
	const restarted = new UpdateManager(home, undefined, lifecycle);
	await restarted.recover("operation owner stopped");
	expect(restarted.status().transaction?.phase).toBe("rolled-back");
	expect(calls.at(-2)).toBe("rollback");
});
it("offline backoff preserves pending and rejects partial/wrong-target releases", async () => {
	const { manager, source } = fixture();
	manager.configure({ channel: "nightly" }, 0);
	await manager.check();
	vi.mocked(source.discover).mockRejectedValue(new Error("offline"));
	await manager.check();
	expect(manager.status().pending?.candidate).toEqual(candidate);
	expect(manager.status().failures).toBe(1);
	expect(manager.status().nextCheckAt).toBeGreaterThan(Date.now());
	vi.mocked(source.discover).mockResolvedValue({
		...candidate,
		target: "linux-x64",
	});
	await manager.check();
	expect(manager.status().error).toMatch("target");
	expect(manager.status().pending?.candidate).toEqual(candidate);
});

it("returning to older stable requires intentional Install even under saved automatic policy", async () => {
	const stable = { ...candidate, channel: "stable" as const, version: "1.0.0" };
	const { home, source, lifecycle, calls } = fixture(stable);
	const manager = new UpdateManager(home, source, lifecycle, {
		...installed,
		version: candidate.version,
		commit: candidate.commit,
	});
	manager.configure({ policy: "idle-auto" }, 0);
	await manager.check();
	await manager.stage();
	await manager.reconcile();
	expect(calls).toEqual([]);
	manager.requestInstall(candidateKey(stable), 1);
	await manager.reconcile();
	expect(calls).toContain("activate");
});
it("staging failures are persisted and automatic polling cannot endlessly reinstall a bad candidate", async () => {
	const { manager, source } = fixture();
	manager.configure({ channel: "nightly" }, 0);
	await manager.check();
	vi.mocked(source.stage).mockRejectedValue(
		new Error("Invalid publisher checksum"),
	);
	await expect(manager.stage()).rejects.toThrow("checksum");
	expect(manager.status().error).toBe("Invalid publisher checksum");
	await manager.tick();
	expect(source.stage).toHaveBeenCalledTimes(1);
});
it("maintenance acquisition uncertainty and release failures remain recoverable", async () => {
	const { manager, lifecycle } = fixture();
	manager.configure({ channel: "nightly" }, 0);
	await manager.check();
	await manager.stage();
	vi.mocked(lifecycle.acquireMaintenance).mockRejectedValueOnce(
		new Error("Lost acknowledgement"),
	);
	await manager.reconcile();
	expect(manager.status().transaction?.phase).toBe("recovery-required");
	await manager.recover("operation owner stopped");
	expect(manager.status().transaction?.phase).toBe("cancelled");
	expect(lifecycle.stop).not.toHaveBeenCalled();
	vi.mocked(lifecycle.releaseMaintenance).mockRejectedValueOnce(
		new Error("Manager suppressed"),
	);
	await manager.reconcile();
	expect(manager.status().transaction?.phase).toBe("recovery-required");
	await manager.recover("operation owner stopped");
	expect(manager.status().transaction?.phase).toBe("succeeded");
	expect(lifecycle.rollback).not.toHaveBeenCalled();
});

it("retries failed exact release after recovery without repeating rollback or changing owner", async () => {
	const { manager, lifecycle } = fixture();
	manager.configure({ channel: "nightly" }, 0);
	await manager.check();
	await manager.stage();
	vi.mocked(lifecycle.acquireMaintenance).mockRejectedValueOnce(
		new Error("Lost acknowledgement"),
	);
	await manager.reconcile();
	const id = manager.status().transaction!.id;
	vi.mocked(lifecycle.releaseMaintenance).mockRejectedValueOnce(
		new Error("release failed"),
	);
	await expect(manager.recover("operation owner stopped")).rejects.toThrow(
		"release failed",
	);
	expect(manager.status().transaction).toMatchObject({
		id,
		phase: "recovery-required",
		release: { transactionId: id, outcome: "cancelled", status: "pending" },
	});
	await expect(manager.reconcile()).rejects.toThrow("recovery");
	await manager.recover("operation owner stopped");
	expect(lifecycle.releaseMaintenance).toHaveBeenNthCalledWith(1, id);
	expect(lifecycle.releaseMaintenance).toHaveBeenNthCalledWith(2, id);
	expect(manager.status().transaction?.release?.status).toBe("acknowledged");
	expect(lifecycle.acquireMaintenance).toHaveBeenCalledTimes(2);
	expect(lifecycle.rollback).not.toHaveBeenCalled();
});
it.each([
	"succeeded",
	"rolled-back",
	"cancelled",
])("recovers interrupted/legacy %s release and preserves completed outcome", async (phase) => {
	const { manager, home, lifecycle } = fixture();
	manager.configure({ channel: "nightly" }, 0);
	await manager.check();
	await manager.stage();
	await manager.reconcile();
	const state = JSON.parse(readFileSync(manager.file, "utf8"));
	const id = state.transaction.id;
	state.transaction.phase = phase;
	delete state.transaction.release; // pre-acknowledgement schema-1 migration
	writeFileSync(manager.file, JSON.stringify(state));
	vi.mocked(lifecycle.releaseMaintenance).mockClear();
	vi.mocked(lifecycle.acquireMaintenance).mockClear();
	const restarted = new UpdateManager(home, undefined, lifecycle);
	await expect(restarted.reconcile()).rejects.toThrow("recovery");
	await restarted.recover("operation owner stopped");
	await restarted.recover("operation owner stopped");
	expect(lifecycle.releaseMaintenance).toHaveBeenCalledExactlyOnceWith(id);
	expect(lifecycle.acquireMaintenance).not.toHaveBeenCalled();
	expect(lifecycle.rollback).not.toHaveBeenCalled();
	expect(restarted.status().transaction).toMatchObject({
		phase,
		release: { transactionId: id, outcome: phase, status: "acknowledged" },
	});
});
it("recovers a lost release response by retrying only the durable release intent", async () => {
	const { manager, home, lifecycle } = fixture();
	manager.configure({ channel: "nightly" }, 0);
	await manager.check();
	await manager.stage();
	vi.mocked(lifecycle.releaseMaintenance).mockImplementationOnce(async (id) => {
		const state = JSON.parse(readFileSync(manager.file, "utf8"));
		expect(state.transaction.release).toEqual({
			transactionId: id,
			outcome: "succeeded",
			status: "pending",
		});
		throw new Error("acknowledgement lost after external release");
	});
	await manager.reconcile();
	await new UpdateManager(home, undefined, lifecycle).recover(
		"operation owner stopped",
	);
	expect(manager.status().transaction?.phase).toBe("succeeded");
	expect(lifecycle.stop).toHaveBeenCalledTimes(1);
	expect(lifecycle.releaseMaintenance).toHaveBeenCalledTimes(2);
	expect(lifecycle.rollback).not.toHaveBeenCalled();
});
it.each([
	{ version: "1.0.0-beta", channel: "stable" as const },
	{ version: "1.0.0-nightly.20261010.100", channel: "nightly" as const },
])("requires exact consent for same-core prerelease downgrade to $version", async ({
	version,
	channel,
}) => {
	const value = { ...candidate, version, channel };
	const { manager, calls } = fixture(value);
	manager.configure({ channel, policy: "idle-auto" }, 0);
	await manager.check();
	await manager.stage();
	await manager.reconcile();
	expect(calls).toEqual([]);
	manager.requestInstall(candidateKey(value), 1);
	await manager.reconcile();
	expect(calls).toContain("activate");
});
