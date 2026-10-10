import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	renameSync,
	symlinkSync,
	unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AcceptanceCleanup, acceptanceRun } from "./acceptance-cleanup.mjs";

const root = () =>
	realpathSync(mkdtempSync(join(tmpdir(), "acceptance-cleanup-regression-")));
const ledger = (options) =>
	new AcceptanceCleanup({ graceMs: 150, killMs: 1500, ...options });
const ready = (child) =>
	new Promise((resolve, reject) => {
		child.stdout.once("data", resolve);
		child.once("error", reject);
	});
const alive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		if (e.code === "ESRCH") return false;
		throw e;
	}
};
const stubborn = `process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)`;

test("TERM-ignoring child escalates; PASS appears only after all child close events", async () => {
	const l = ledger(),
		dir = root(),
		path = join(dir, "receipt.json");
	const c = l.spawn(process.execPath, ["-e", stubborn], {
		stdio: ["ignore", "pipe", "ignore"],
	});
	await ready(c);
	const result = await acceptanceRun({
		ledger: l,
		receiptPath: path,
		work: async () => ({ scenario: "stubborn" }),
	});
	assert.equal(result.passed, true);
	assert.deepEqual(result.cleanup.escalated, [c.pid]);
	assert.equal(result.cleanup.children[0].signal, "SIGKILL");
	assert.equal(alive(c.pid), false);
	assert.equal(JSON.parse(readFileSync(path)).passed, true);
});

test("leader exits first; its TERM-ignoring descendant is still drained", async () => {
	const l = ledger(),
		path = join(root(), "receipt.json");
	const code = `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',${JSON.stringify(stubborn)}],{stdio:['ignore','pipe','ignore']});c.stdout.once('data',()=>console.log(c.pid));process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);`;
	const parent = l.spawn(process.execPath, ["-e", code], {
		stdio: ["ignore", "pipe", "ignore"],
	});
	let descendant;
	await new Promise((r) =>
		parent.stdout.once("data", (data) => {
			descendant = Number(String(data).trim());
			r();
		}),
	);
	l.scan();
	parent.kill("SIGTERM");
	await new Promise((r) => parent.once("exit", r));
	const result = await acceptanceRun({
		ledger: l,
		receiptPath: path,
		work: async () => ({}),
	});
	assert.equal(result.passed, true);
	assert.deepEqual(result.cleanup.escalated, [parent.pid]);
	assert.equal(result.cleanup.remaining.length, 0);
	// A reparented zombie is terminated even if the OS has not yet reaped its PID.
	assert(result.cleanup.groups.includes(parent.pid));
	assert(descendant > 0);
	const remaining = execFileSync("/bin/ps", ["-axo", "pid=,stat="], {
		encoding: "utf8",
	})
		.split("\n")
		.find((line) => Number(line.trim().split(/\s+/)[0]) === descendant);
	assert(
		!remaining || remaining.trim().split(/\s+/)[1].startsWith("Z"),
		"Descendant must be gone or terminated zombie",
	);
});

test("failed owned lock removal fails receipt while unrelated foreground process survives", async () => {
	const home = root();
	mkdirSync(join(home, "runtime"));
	const unrelated = spawn(process.execPath, ["-e", stubborn], {
		stdio: ["ignore", "pipe", "ignore"],
	});
	await ready(unrelated);
	const l = ledger({
		homes: [home],
		validateOwner: () => true,
		removeLock: () => {
			throw Error("Injected lock removal failure");
		},
	});
	try {
		const c = l.spawn(process.execPath, ["-e", stubborn], {
			stdio: ["ignore", "pipe", "ignore"],
		});
		await ready(c);
		const path = join(home, "runtime", "worker.lock");
		symlinkSync(
			JSON.stringify({
				schema: 1,
				pid: c.pid,
				home,
				nonce: "fixture",
				processStamp: execFileSync(
					"/bin/ps",
					["-p", String(c.pid), "-o", "lstart="],
					{ encoding: "utf8" },
				).trim(),
			}),
			path,
		);
		l.scan();
		const result = await acceptanceRun({
			ledger: l,
			receiptPath: join(home, "receipt.json"),
			work: async () => ({}),
		});
		assert.equal(result.passed, false);
		assert(
			result.cleanup.failures.some((x) =>
				x.includes("Injected lock removal failure"),
			),
		);
		assert.equal(alive(c.pid), false);
		assert.equal(alive(unrelated.pid), true);
		unlinkSync(path);
	} finally {
		unrelated.kill("SIGKILL");
		await new Promise((r) => unrelated.once("close", r));
	}
});

test("overwritten lock cannot authorize signaling or removal of unrelated PID", async () => {
	const home = root();
	mkdirSync(join(home, "runtime"));
	const path = join(home, "runtime", "worker.lock");
	const l = ledger({ homes: [home], validateOwner: () => true });
	const c = l.spawn(process.execPath, ["-e", stubborn], {
		stdio: ["ignore", "pipe", "ignore"],
	});
	await ready(c);
	const owner = {
		schema: 1,
		pid: c.pid,
		home,
		nonce: "fixture",
		processStamp: execFileSync(
			"/bin/ps",
			["-p", String(c.pid), "-o", "lstart="],
			{ encoding: "utf8" },
		).trim(),
	};
	symlinkSync(JSON.stringify(owner), path);
	l.scan();
	const changed = JSON.stringify({
		...owner,
		pid: process.pid,
		nonce: "overwrite",
	});
	unlinkSync(path);
	symlinkSync(changed, path);
	const result = await acceptanceRun({
		ledger: l,
		receiptPath: join(home, "receipt.json"),
		work: async () => ({}),
	});
	assert.equal(result.passed, false);
	assert.equal(readlinkSync(path), changed);
	assert.equal(alive(c.pid), false);
	unlinkSync(path);
});

test("actual controller SIGTERM creates FAIL after cleanup, receipt outside fixture HOME", async () => {
	const dir = root(),
		path = join(dir, "outside-home-receipt.json");
	const module = new URL("./acceptance-cleanup.mjs", import.meta.url).href;
	const script = `import {AcceptanceCleanup,acceptanceRun} from ${JSON.stringify(module)};const ledger=new AcceptanceCleanup({graceMs:150,killMs:1500});const result=await acceptanceRun({ledger,receiptPath:${JSON.stringify(path)},work:async()=>{const child=ledger.spawn(process.execPath,['-e',${JSON.stringify(stubborn)}],{stdio:['ignore','pipe','ignore']});await new Promise(r=>child.stdout.once('data',r));console.log(child.pid);await new Promise(()=>{});}});process.exit(result.passed?0:1);`;
	const controller = spawn(
		process.execPath,
		["--input-type=module", "-e", script],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	let pid;
	await new Promise((r) =>
		controller.stdout.once("data", (data) => {
			pid = Number(String(data).trim());
			r();
		}),
	);
	controller.kill("SIGTERM");
	const code = await new Promise((r) => controller.once("exit", r));
	const receipt = JSON.parse(readFileSync(path));
	assert.equal(code, 1);
	assert.equal(receipt.passed, false);
	assert.equal(receipt.cancellation, "SIGTERM");
	assert.equal(receipt.cleanup.passed, true);
	assert.equal(alive(pid), false);
});

test("stale PID stamp never signals a reused unrelated process", async () => {
	const home = root();
	mkdirSync(join(home, "runtime"));
	const unrelated = spawn(process.execPath, ["-e", stubborn], {
		detached: true,
		stdio: ["ignore", "pipe", "ignore"],
	});
	await ready(unrelated);
	const l = ledger({ homes: [home], validateOwner: () => true });
	const path = join(home, "runtime", "worker.lock");
	try {
		symlinkSync(
			JSON.stringify({
				schema: 1,
				pid: unrelated.pid,
				home,
				nonce: "stale",
				processStamp: "Sun Jan  1 00:00:00 2000",
			}),
			path,
		);
		const result = await acceptanceRun({
			ledger: l,
			receiptPath: join(home, "receipt.json"),
			work: async () => ({}),
		});
		assert.equal(result.passed, false);
		assert.equal(alive(unrelated.pid), true);
		assert.equal(result.cleanup.groups.length, 0);
		assert.equal(JSON.parse(readlinkSync(path)).nonce, "stale");
	} finally {
		unlinkSync(path);
		unrelated.kill("SIGKILL");
		await new Promise((r) => unrelated.once("close", r));
	}
});

test("cleanup exception produces a failed receipt and nonzero controller exit", async () => {
	const dir = root(),
		path = join(dir, "receipt.json"),
		module = new URL("./acceptance-cleanup.mjs", import.meta.url).href;
	const script = `import {acceptanceRun} from ${JSON.stringify(module)};const result=await acceptanceRun({ledger:{cleanup:async()=>{throw Error('Injected cleanup exception');}},receiptPath:${JSON.stringify(path)},work:async()=>({})});process.exit(result.passed?0:1);`;
	const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
		stdio: "ignore",
	});
	const code = await new Promise((r) => child.once("exit", r));
	const receipt = JSON.parse(readFileSync(path));
	assert.equal(code, 1);
	assert.equal(receipt.passed, false);
	assert.deepEqual(receipt.cleanup.failures, ["Injected cleanup exception"]);
});

test("replacement fixture home cannot authorize removing a copied lock", async () => {
	const home = root();
	mkdirSync(join(home, "runtime"));
	const path = join(home, "runtime", "worker.lock");
	const l = ledger({ homes: [home], validateOwner: () => true });
	const child = l.spawn(process.execPath, ["-e", stubborn], {
		stdio: ["ignore", "pipe", "ignore"],
	});
	await ready(child);
	const owner = JSON.stringify({
		schema: 1,
		pid: child.pid,
		home,
		nonce: "original",
		processStamp: execFileSync(
			"/bin/ps",
			["-p", String(child.pid), "-o", "lstart="],
			{ encoding: "utf8" },
		).trim(),
	});
	symlinkSync(owner, path);
	l.scan();
	renameSync(home, `${home}-original`);
	mkdirSync(join(home, "runtime"), { recursive: true });
	symlinkSync(owner, path);
	const result = await acceptanceRun({
		ledger: l,
		receiptPath: join(home, "receipt.json"),
		work: async () => ({}),
	});
	assert.equal(result.passed, false);
	assert.equal(alive(child.pid), false);
	assert.equal(readlinkSync(path), owner);
	unlinkSync(path);
	unlinkSync(join(`${home}-original`, "runtime", "worker.lock"));
});
