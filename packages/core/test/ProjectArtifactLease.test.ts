import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ProjectArtifactLease } from "../src/ProjectArtifactLease.js";

const roots: string[] = [];
const fixture = () => {
	const root = mkdtempSync(join(tmpdir(), "project-lease-"));
	roots.push(root);
	return { root, privateDirectory: join(root, "private") };
};
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
it("refuses competing writers and restores original files and modes without a worktree backup", () => {
	const { root, privateDirectory } = fixture();
	writeFileSync(join(root, "settings.json"), "original", { mode: 0o640 });
	const lease = new ProjectArtifactLease(root, "runner", privateDirectory);
	lease.write("settings.json", "selected-secret");
	expect(statSync(join(root, "settings.json")).mode & 0o777).toBe(0o600);
	expect(
		() => new ProjectArtifactLease(root, "runner", privateDirectory),
	).toThrow("Another process");
	const otherRoot = fixture().root;
	const independent = new ProjectArtifactLease(
		otherRoot,
		"runner",
		privateDirectory,
	);
	independent.write("settings.json", "other");
	independent.release();
	lease.release();
	expect(readFileSync(join(root, "settings.json"), "utf8")).toBe("original");
	expect(statSync(join(root, "settings.json")).mode & 0o777).toBe(0o640);
	expect(existsSync(join(otherRoot, "settings.json"))).toBe(false);
});
it("preserves external edits and retains the private recovery journal instead of overwriting them", () => {
	const { root, privateDirectory } = fixture();
	const lease = new ProjectArtifactLease(root, "runner", privateDirectory);
	lease.write("settings.json", "generated");
	writeFileSync(join(root, "settings.json"), "human edit");
	expect(() => lease.release()).toThrow("modified by another writer");
	expect(readFileSync(join(root, "settings.json"), "utf8")).toBe("human edit");
	expect(
		() => new ProjectArtifactLease(root, "runner", privateDirectory),
	).toThrow("Another process");
});
it("recovers a real exited process before materializing the next job", () => {
	const { root, privateDirectory } = fixture();
	writeFileSync(join(root, "settings.json"), "original");
	const source = new URL("../dist/ProjectArtifactLease.js", import.meta.url)
		.href;
	execFileSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`import {ProjectArtifactLease} from ${JSON.stringify(source)};const lease=new ProjectArtifactLease(${JSON.stringify(root)},'runner',${JSON.stringify(privateDirectory)});lease.write('settings.json','crashed-secret');`,
		],
		{ stdio: "pipe" },
	);
	const lease = new ProjectArtifactLease(root, "runner", privateDirectory);
	expect(readFileSync(join(root, "settings.json"), "utf8")).toBe("original");
	lease.write("settings.json", "new job");
	lease.release();
	expect(readFileSync(join(root, "settings.json"), "utf8")).toBe("original");
});

it("queues jobs using the same workspace journal and lets cancellation end the wait", async () => {
	const directory = mkdtempSync(join(tmpdir(), "artifact-queue-"));
	const first = new ProjectArtifactLease(directory, "cursor");
	const controller = new AbortController();
	const cancelled = ProjectArtifactLease.acquire(
		directory,
		"cursor",
		undefined,
		controller.signal,
	);
	controller.abort(new Error("Cancelled waiting job"));
	await expect(cancelled).rejects.toThrow("Cancelled waiting job");
	const waiting = ProjectArtifactLease.acquire(directory, "cursor");
	first.release();
	const second = await waiting;
	second.release();
	rmSync(directory, { recursive: true, force: true });
});
