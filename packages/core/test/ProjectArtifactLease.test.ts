import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
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

it.each([
	true,
	false,
])("cleans partial owned temporaries after interruption before rename (original=%s)", (original) => {
	const { root, privateDirectory } = fixture();
	const file = join(root, "settings.json");
	if (original) writeFileSync(file, "original", { mode: 0o640 });
	const source = new URL("../dist/ProjectArtifactLease.js", import.meta.url)
		.href;
	execFileSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`
		import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
		const rename=fs.renameSync;fs.renameSync=(from,to)=>{if(String(to).endsWith("/settings.json"))process.exit(0);return rename(from,to)};syncBuiltinESMExports();
		const {ProjectArtifactLease}=await import(${JSON.stringify(source)});
		new ProjectArtifactLease(${JSON.stringify(root)},'runner',${JSON.stringify(privateDirectory)}).write('settings.json','interrupted-canary-secret');
	`,
		],
		{ stdio: "pipe" },
	);
	const foreign = `${file}.another-owner.tmp`;
	writeFileSync(foreign, "other writer");
	const before = readdirSync(root).filter((name) => name.endsWith(".tmp"));
	expect(before).toHaveLength(2);
	ProjectArtifactLease.recoverOwnedArtifacts(root, "runner", privateDirectory);
	expect(readdirSync(root).filter((name) => name.endsWith(".tmp"))).toEqual([
		"settings.json.another-owner.tmp",
	]);
	expect(readFileSync(foreign, "utf8")).toBe("other writer");
	expect(existsSync(file)).toBe(original);
	if (original) {
		expect(readFileSync(file, "utf8")).toBe("original");
		expect(statSync(file).mode & 0o777).toBe(0o640);
	}
});
