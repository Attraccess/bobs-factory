import {
	mkdtempSync,
	readFileSync,
	realpathSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquireInstanceLock, workerOwner } from "./InstanceLock.js";
import {
	type ServiceExecutor,
	ServiceLifecycle,
	serviceDefinition,
	updateServiceRecord,
} from "./ServiceLifecycle.js";

function fixture(platform = "linux") {
	const root = realpathSync(
			mkdtempSync(join(tmpdir(), "factory-service-test-")),
		),
		calls: string[][] = [];
	const run: ServiceExecutor = (command, args) => {
		calls.push([command, ...args]);
		return { status: 0, output: "ActiveState=inactive\n" };
	};
	const manager = new ServiceLifecycle(
		join(root, "state"),
		run,
		platform,
		root,
		501,
	);
	const executable = join(root, 'factory executable%$\\"');
	writeFileSync(executable, "fixture");
	return { root, calls, manager, executable };
}
describe("user service ownership", () => {
	it("reconciles a verified dead worker on maintenance without changing caller provenance", async () => {
		const { manager, executable } = fixture();
		manager.install(executable);
		const record = manager.record()!;
		symlinkSync(
			JSON.stringify({
				schema: 1,
				pid: 2147483647,
				nonce: "dead-native-startup",
				home: record.home,
				processStamp: "dead",
				executable,
				owner: "service",
			}),
			join(record.home, "runtime", "worker.lock"),
		);
		const marker = process.env.BOBS_FACTORY_WORKER_ID;
		await manager.action("maintenance");
		expect(workerOwner(record.home)).toBeUndefined();
		expect(process.env.BOBS_FACTORY_WORKER_ID).toBe(marker);
		expect(manager.record()?.desired).toBe("maintenance");
	});
	it("install is stopped and not enrolled, with no manager start", () => {
		const { manager, executable, calls } = fixture();
		manager.install(executable);
		expect(manager.record()).toMatchObject({
			startup: false,
			desired: "stopped",
			executable,
		});
		expect(calls.some((c) => c.includes("start") || c.includes("enable"))).toBe(
			false,
		);
		expect(serviceDefinition(manager.record()!)).toContain("ExecStart=");
	});
	it("maintenance survives interruption and blocks restart/start/enable until resume", async () => {
		const { manager, executable } = fixture();
		manager.install(executable);
		await manager.action("maintenance");
		const restored = new ServiceLifecycle(
			manager.home,
			() => ({ status: 0, output: "inactive" }),
			"linux",
			manager.home.replace(/\/state$/, ""),
			501,
		);
		for (const action of ["start", "restart", "enable"] as const)
			await expect(restored.action(action)).rejects.toThrow("maintenance");
		expect(restored.record()!.desired).toBe("maintenance");
		await restored.resume();
		expect(restored.record()!.desired).toBe("running");
	});
	it("keeps the external updater alive during worker maintenance and stops both deliberately", async () => {
		const { manager, executable, calls } = fixture();
		manager.install(executable);
		const updater = updateServiceRecord(manager.record()!);
		expect(readFileSync(updater.definition, "utf8")).toContain('"updates-run"');
		await manager.action("start");
		expect(
			calls.filter((c) => c.includes("start")).map((c) => c.at(-1)),
		).toEqual([`${manager.record()!.id}.service`, `${updater.id}.service`]);
		calls.length = 0;
		await manager.action("maintenance");
		expect(
			calls.filter((c) => c.includes("stop")).map((c) => c.at(-1)),
		).toEqual([`${manager.record()!.id}.service`]);
		await manager.resume();
		calls.length = 0;
		await manager.action("stop");
		expect(
			calls.filter((c) => c.includes("stop")).map((c) => c.at(-1)),
		).toEqual([`${manager.record()!.id}.service`, `${updater.id}.service`]);
	});

	it("resumes interrupted stopped setup without adopting externally changed definitions", () => {
		const { manager, executable, calls } = fixture();
		manager.install(executable);
		const updater = updateServiceRecord(manager.record()!);
		unlinkSync(updater.definition);
		manager.install(executable);
		expect(readFileSync(updater.definition, "utf8")).toBe(
			serviceDefinition(updater, true),
		);
		expect(calls.some((c) => c.includes("start") || c.includes("enable"))).toBe(
			false,
		);
		unlinkSync(updater.definition);
		writeFileSync(manager.record()!.definition, "external");
		expect(() => manager.install(executable)).toThrow("changed externally");
	});

	it("external changes prevent stop/remove from destroying unmanaged definitions", async () => {
		const { manager, executable } = fixture();
		manager.install(executable);
		const definition = manager.record()!.definition;
		writeFileSync(definition, "external definition");
		await expect(manager.action("remove")).rejects.toThrow(
			"changed externally",
		);
		expect(readFileSync(definition, "utf8")).toBe("external definition");
	});
	it("retains removed definitions and state, not user credentials", async () => {
		const { manager, executable } = fixture();
		manager.install(executable);
		writeFileSync(join(manager.home, "native-marker"), "keep");
		const result = (await manager.action("remove")) as {
			removed: boolean;
			retainedDefinition: string;
		};
		expect(result.removed).toBe(true);
		expect(readFileSync(result.retainedDefinition, "utf8")).toContain(
			"Bob's Factory",
		);
		expect(readFileSync(join(manager.home, "native-marker"), "utf8")).toBe(
			"keep",
		);
	});
	it("canonical ownership blocks concurrent workers and service adoption", async () => {
		const { manager, executable } = fixture();
		const release = await acquireInstanceLock(manager.home);
		try {
			await expect(acquireInstanceLock(manager.home)).rejects.toThrow(
				"already owned",
			);
			expect(() => manager.install(executable)).toThrow("Existing worker");
		} finally {
			release();
		}
		manager.install(executable);
	});
	it("macOS definitions escape paths and do not enroll startup", () => {
		const { manager, executable } = fixture("darwin");
		manager.install(executable);
		const definition = readFileSync(manager.record()!.definition, "utf8");
		expect(definition).toContain("&quot;");
		expect(definition).toContain("<key>RunAtLoad</key><false/>");
	});
});
