import { type ChildProcess, fork } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const modulePath = fileURLToPath(new URL("./InstanceLock.ts", import.meta.url));
function launch(
	script: string,
	home: string,
	orphan = false,
): Promise<{
	child: ChildProcess;
	data: { pid: number; orphan?: number; error?: string };
}> {
	const child = fork(script, [modulePath, home, orphan ? "orphan" : ""], {
		stdio: ["ignore", "ignore", "ignore", "ipc"],
	});
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error("Fixture timeout"));
		}, 12000);
		child.once("message", (data) => {
			clearTimeout(timer);
			resolve({
				child,
				data: data as { pid: number; orphan?: number; error?: string },
			});
		});
		child.once("error", reject);
	});
}
it("crashed worker orphan is drained and concurrent recovery admits only one replacement", async () => {
	const root = mkdtempSync(join(tmpdir(), "factory-orphan-")),
		home = join(root, "home"),
		script = join(root, "worker.mjs");
	writeFileSync(
		script,
		`import {spawn} from 'node:child_process';const {acquireInstanceLock}=await import(process.argv[2]);let release;try{release=await acquireInstanceLock(process.argv[3]);const orphan=process.argv[4]==='orphan'?spawn('/bin/sleep',['300'],{detached:true,stdio:'ignore',env:process.env}):null;orphan?.unref();process.send({pid:process.pid,orphan:orphan?.pid});process.on('message',()=>{release();process.exit(0);});}catch(error){process.send({error:error.message,pid:process.pid});process.exit(1);}`,
	);
	const first = await launch(script, home, true);
	expect(first.data.error).toBeUndefined();
	const exited = new Promise((resolve) => first.child.once("exit", resolve));
	first.child.kill("SIGKILL");
	await exited;
	const results = await Promise.all([
		launch(script, home),
		launch(script, home),
	]);
	try {
		expect(results.filter((r) => !r.data.error)).toHaveLength(1);
		expect(results.filter((r) => r.data.error)).toHaveLength(1);
		// A zombie may await its system reaper; it must have no inherited execution marker.
		const { execFileSync } = await import("node:child_process");
		const output = execFileSync("/bin/ps", ["axeww", "-o", "pid=,command="], {
			encoding: "utf8",
			maxBuffer: 32 * 1024 * 1024,
		});
		const lines = output
			.split("\n")
			.filter((l) => l.trim().startsWith(`${String(first.data.orphan)} `));
		expect(lines.some((l) => l.includes("BOBS_FACTORY_WORKER_ID="))).toBe(
			false,
		);
	} finally {
		for (const r of results)
			if (!r.data.error) {
				const done = new Promise((resolve) => r.child.once("exit", resolve));
				r.child.send("stop");
				await done;
			}
	}
	expect(existsSync(join(home, "runtime", "worker.lock"))).toBe(false);
}, 20000);
