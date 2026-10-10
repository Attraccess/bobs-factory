// Regression: a valid, briefly held updater write lock must not kill a replacement.
// No service registration, providers, host stores or production homes.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { UpdateManager } from "../../packages/edge-worker/dist/updates/UpdateManager.js";
import { jsonBytes, sha256 } from "../lib/binary-release.mjs";

const [executableArg, outputArg] = process.argv.slice(2);
assert(executableArg && outputArg, "Supply NATIVE_EXECUTABLE and RECEIPT");
const executable = resolve(executableArg),
	output = resolve(outputArg);
assert(
	executable && output,
	"Usage: node native-update-startup-contention.mjs NATIVE_EXECUTABLE RECEIPT",
);
const work = mkdtempSync(join(tmpdir(), "bobs-startup-contention-"));
const home = join(work, "instance");
mkdirSync(home);
const b = JSON.parse(readFileSync(join(dirname(executable), "build.json")));
const env = { PATH: process.env.PATH, HOME: work, TMPDIR: work };
const candidate = {
	version: b.version,
	commit: b.commit,
	target: b.target,
	channel: b.version.includes("nightly") ? "nightly" : "stable",
	manifestSha256: sha256("controlled startup identity"),
	publishedAt: "2026-10-10T18:00:00.000Z",
};
const manager = new UpdateManager(home, undefined, undefined, b);
manager.configure({ channel: candidate.channel }, 0);
const listener = createServer();
await new Promise((done) => listener.listen(0, "127.0.0.1", done));
const port = listener.address().port;
await new Promise((done) => listener.close(done));
const journal = JSON.parse(readFileSync(join(home, "updates/state.json")));
journal.installed = { ...b, version: "0.0.1", commit: "a".repeat(40) };
journal.transaction = {
	id: "controlled-startup-contention",
	candidate,
	staged: { candidate, executable, previousExecutable: executable },
	previous: journal.installed,
	revision: journal.revision,
	phase: "starting",
	switchStarted: true,
	startedAt: new Date().toISOString(),
};
writeFileSync(join(home, "updates/state.json"), jsonBytes(journal));
writeFileSync(join(home, "config.json"), jsonBytes({ repositories: [] }));
const before = readFileSync(join(home, "updates/state.json"), "utf8");
const lock = join(home, "updates/state.lock");
writeFileSync(lock, String(process.pid), { flag: "wx" });
let stderr = "",
	stdout = "";
const child = spawn(
	executable,
	["--home", home, "--port", String(port), "--no-open", "local"],
	{ env, stdio: ["ignore", "pipe", "pipe"] },
);
child.stdout.on("data", (b) => (stdout += b));
child.stderr.on("data", (b) => (stderr += b));
const close = new Promise((r) =>
	child.once("close", (code, signal) => r({ code, signal })),
);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let healthy = false,
	exit;
try {
	// The live fixture owns this writer lock; only that owner removes it.
	await wait(500);
	assert.equal(readFileSync(lock, "utf8"), String(process.pid));
	rmSync(lock);
	for (let n = 0; n < 100 && child.exitCode === null; n++) {
		try {
			if ((await fetch(`http://127.0.0.1:${port}/api/auth/status`)).ok) {
				healthy = true;
				break;
			}
		} catch {}
		await wait(50);
	}
	exit = { code: child.exitCode, signal: child.signalCode };
	assert.equal(
		readFileSync(join(home, "updates/state.json"), "utf8"),
		before,
		"Startup must preserve the supervisor transaction and installed view",
	);
} finally {
	if (child.exitCode === null) child.kill("SIGTERM");
	await close;
	// Retain diagnosis without enrollment codes or any credential material.
	const error = stderr
		.split("\n")
		.filter((l) =>
			/Fatal error|Update settings|at change|at observeInstalled|at new FactoryServer/.test(
				l,
			),
		);
	writeFileSync(
		output,
		jsonBytes({
			sourceCommit: b.commit,
			target: b.target,
			executableSha256: b.executable.sha256,
			home,
			healthy,
			installedStateUnchanged:
				readFileSync(join(home, "updates/state.json"), "utf8") === before,
			exit,
			error,
			passed: healthy,
			purpose:
				"native replacement startup under bounded live updater state-lock contention",
		}),
	);
}
assert.equal(
	healthy,
	true,
	"Native replacement startup failed during a valid transient updater write; inspect contention receipt",
);
