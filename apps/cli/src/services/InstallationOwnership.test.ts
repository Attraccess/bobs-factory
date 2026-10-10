import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
	assertInstallationProof,
	installationProof,
} from "./InstallationOwnership.js";
import { OwnedUpdateLifecycle } from "./OwnedUpdateLifecycle.js";
import { ServiceLifecycle } from "./ServiceLifecycle.js";

it("external symlink permission to launch does not authorize automatic replacement", () => {
	const home = realpathSync(
		mkdtempSync(join(tmpdir(), "factory-external-owner-")),
	);
	const external = join(home, "external-binary"),
		link = join(home, "external-link");
	writeFileSync(external, "external");
	symlinkSync(external, link);
	const service = new ServiceLifecycle(
		home,
		() => ({ status: 0, output: "" }),
		"linux",
		home,
		501,
	);
	service.install(link);
	expect(service.record()?.updateOwner).toBeUndefined();
	expect(service.status().updateSupported).toBe(false);
	const saved = service.record();
	const read = vi
		.spyOn(ServiceLifecycle.prototype, "record")
		.mockReturnValue(saved);
	try {
		expect(() => new OwnedUpdateLifecycle(home, 3457)).toThrow(
			"no bound installer ownership",
		);
	} finally {
		read.mockRestore();
	}
	expect(realpathSync(link)).toBe(external);
	expect(readFileSync(external, "utf8")).toBe("external");
});
it("binds genuine installer layout and immutable receipt; changed provenance rejects maintenance", async () => {
	const home = realpathSync(
			mkdtempSync(join(tmpdir(), "factory-proven-owner-")),
		),
		prefix = join(home, "installed"),
		name = "bobs-factory-1.0.0-linux-x64";
	mkdirSync(join(prefix, "bin"), { recursive: true });
	mkdirSync(join(prefix, "lib", "bobs-factory", name), { recursive: true });
	mkdirSync(join(prefix, "lib", "bobs-factory", "records"));
	const target = join(prefix, "lib", "bobs-factory", name, "bobs-factory"),
		link = join(prefix, "bin", "bobs-factory"),
		record = join(prefix, "lib", "bobs-factory", "records", `${name}.json`);
	writeFileSync(target, "owned");
	const identity = {
		product: "bobs-factory",
		version: "1.0.0",
		target: "linux-x64",
		commit: "a".repeat(40),
	};
	writeFileSync(
		join(prefix, "lib", "bobs-factory", name, "build.json"),
		JSON.stringify(identity),
	);
	symlinkSync(target, link);
	const receipt = {
		...identity,
		schemaVersion: 1,
		owner: "bobs-factory-installer",
		source: "archive",
		channel: "stable",
	};
	writeFileSync(record, JSON.stringify(receipt));
	const service = new ServiceLifecycle(
		home,
		() => ({ status: 0, output: "" }),
		"linux",
		home,
		501,
	);
	service.install(link);
	const proof = installationProof(home, link);
	expect(proof?.kind).toBe("installer");
	assertInstallationProof(home, link, proof);
	const saved = { ...service.record()!, desired: "running" as const };
	const read = vi
		.spyOn(ServiceLifecycle.prototype, "record")
		.mockReturnValue(saved);
	const adapter = new OwnedUpdateLifecycle(home, 3457);
	writeFileSync(record, JSON.stringify({ ...receipt, owner: "external" }));
	expect(() => assertInstallationProof(home, link, proof)).toThrow(
		"ownership changed",
	);
	try {
		await expect(adapter.acquireMaintenance("test-update")).rejects.toThrow(
			"ownership changed",
		);
		writeFileSync(record, JSON.stringify(receipt));
		writeFileSync(join(home, "runtime", "desktop-stopped.json"), "{}");
		await expect(adapter.start()).rejects.toThrow("Deliberate Stop");
		const snapshot = join(home, "updates", "snapshots", "stopped-rollback");
		mkdirSync(snapshot, { recursive: true });
		await expect(
			adapter.rollback({
				id: "stopped-rollback",
				snapshot,
				staged: {
					candidate: identity,
					executable: target,
					previousExecutable: target,
				},
			}),
		).rejects.toThrow("Deliberate Stop");
		expect(existsSync(join(home, "runtime", "worker.lock"))).toBe(false);
		expect(existsSync(join(home, "runtime", "desktop-stopped.json"))).toBe(
			true,
		);
	} finally {
		read.mockRestore();
	}
});

it("normalizes a selected desktop home alias before validating its canonical receipt", () => {
	const root = realpathSync(
			mkdtempSync(join(tmpdir(), "factory-desktop-alias-")),
		),
		home = join(root, "state"),
		alias = join(root, "alias");
	const prefix = join(home, "runtime", "desktop-installed"),
		name = "bobs-factory-1.0.0-linux-x64",
		target = join(prefix, "lib", "bobs-factory", name, "bobs-factory"),
		link = join(prefix, "bin", "bobs-factory");
	mkdirSync(join(prefix, "bin"), { recursive: true });
	mkdirSync(join(prefix, "lib", "bobs-factory", name), { recursive: true });
	symlinkSync(home, alias);
	writeFileSync(target, "owned");
	symlinkSync(target, link);
	writeFileSync(
		join(home, "runtime", "desktop-runtime.json"),
		JSON.stringify({
			schema: 1,
			home,
			executable: link,
			initial: {
				product: "bobs-factory",
				version: "1.0.0",
				target: "linux-x64",
				commit: "a".repeat(40),
			},
		}),
	);
	const adapter = new OwnedUpdateLifecycle(alias, 3457);
	expect(adapter.home).toBe(home);
	expect(adapter.runtimeLink).toBe(link);
});
