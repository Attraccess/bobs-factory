import { spawn } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { afterEach, expect, it, vi } from "vitest";
import { UpdateOperationLock } from "../src/updates/UpdateOperationLock.js";

const homes: string[] = [];
afterEach(() => {
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
function fixture() {
	const home = mkdtempSync(join(tmpdir(), "update-lock-regression-"));
	homes.push(home);
	return { home, file: join(home, "operation.lock") };
}
it("serializes two processes recovering the same stale operation and preserves the winning owner's lock", async () => {
	const { home, file } = fixture();
	// Bundle the production lock (including zod), so this regression never
	// depends on a stale dist build or copies the lock implementation.
	const module = join(home, "lock.mjs");
	await build({
		entryPoints: [
			new URL("../src/updates/UpdateOperationLock.ts", import.meta.url)
				.pathname,
		],
		outfile: module,
		bundle: true,
		platform: "node",
		format: "esm",
	});
	const script = join(home, "recover.mjs");
	writeFileSync(
		file,
		JSON.stringify({
			pid: 999999999,
			id: "stale",
			start: "stale start",
			startedAt: "fixture",
		}),
	);
	writeFileSync(
		script,
		`import {UpdateOperationLock} from './lock.mjs';
import {writeFileSync,existsSync} from 'node:fs';
const [file, prefix, start] = process.argv.slice(2);
const until = async path => { while(!existsSync(path)) await new Promise(r=>setTimeout(r,5)); };
writeFileSync(prefix+'.ready','1');
await until(start);
try { await new UpdateOperationLock(file).run(async()=>{
 writeFileSync(prefix+'.acquired','1'); await until(prefix+'.finish');
},true); writeFileSync(prefix+'.result','completed'); }
catch(error) { writeFileSync(prefix+'.result',error.message); }
`,
	);
	const children = ["A", "B"].map((role) =>
		spawn(
			process.execPath,
			[script, file, join(home, role), join(home, "go")],
			{ stdio: "ignore" },
		),
	);
	const exits = children.map(
		(child) => new Promise((resolve) => child.once("exit", resolve)),
	);
	try {
		await vi.waitFor(() =>
			expect(
				["A", "B"].every((role) => existsSync(join(home, `${role}.ready`))),
			).toBe(true),
		);
		writeFileSync(join(home, "go"), "1");
		await vi.waitFor(() =>
			expect(
				["A", "B"].some((role) => existsSync(join(home, `${role}.acquired`))),
			).toBe(true),
		);
		const winner = ["A", "B"].find((role) =>
			existsSync(join(home, `${role}.acquired`)),
		)!;
		const loser = winner === "A" ? "B" : "A";
		const owner = readFileSync(file, "utf8");
		await vi.waitFor(() =>
			expect(existsSync(join(home, `${loser}.result`))).toBe(true),
		);
		expect(readFileSync(join(home, `${loser}.result`), "utf8")).toMatch(
			"still running",
		);
		expect(existsSync(join(home, `${loser}.acquired`))).toBe(false);
		expect(readFileSync(file, "utf8")).toBe(owner);
		writeFileSync(join(home, `${winner}.finish`), "1");
		await Promise.all(exits);
		expect(readFileSync(join(home, `${winner}.result`), "utf8")).toBe(
			"completed",
		);
		expect(existsSync(file)).toBe(false);
	} finally {
		for (const child of children) if (child.exitCode === null) child.kill();
		await Promise.all(exits);
	}
});
it("reclaims a reused PID only with a different recorded process start identity", async () => {
	const { file } = fixture();
	writeFileSync(
		file,
		JSON.stringify({
			pid: process.pid,
			id: "previous-incarnation",
			start: "not this process start",
			startedAt: "fixture",
		}),
	);
	await new UpdateOperationLock(file).run(async () => {
		expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({
			pid: process.pid,
		});
		expect(JSON.parse(readFileSync(file, "utf8")).id).not.toBe(
			"previous-incarnation",
		);
	}, true);
	expect(existsSync(file)).toBe(false);
});
it("cleanup retains a replacement owner's exact record", async () => {
	const { file } = fixture();
	const other = JSON.stringify({
		pid: process.pid,
		id: "replacement",
		start: "fixture",
		startedAt: "fixture",
	});
	await new UpdateOperationLock(file).run(async () => {
		writeFileSync(file, other);
	});
	expect(readFileSync(file, "utf8")).toBe(other);
});
it("recovers a stale reclaim guard and fails closed for live legacy owners", async () => {
	const { file } = fixture();
	const { symlinkSync } = await import("node:fs");
	symlinkSync(
		JSON.stringify({
			pid: 999999999,
			id: "guard",
			start: "old",
			startedAt: "fixture",
		}),
		`${file}.reclaim`,
	);
	writeFileSync(file, JSON.stringify({ pid: process.pid }));
	await expect(
		new UpdateOperationLock(file).run(async () => {}, true),
	).rejects.toThrow("legacy identity");
	expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ pid: process.pid });
	expect(existsSync(`${file}.reclaim`)).toBe(false);
});
