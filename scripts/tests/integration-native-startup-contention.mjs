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
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	ownerAlive,
	workerOwner,
} from "../../apps/cli/dist/src/services/InstanceLock.js";
import { UpdateManager } from "../../packages/edge-worker/dist/updates/UpdateManager.js";
import { jsonBytes, sha256 } from "../lib/binary-release.mjs";
import { cleanupFixtureTreeAfterReceipt } from "./signed-delivery-harness-lifecycle.mjs";
import { terminateOwnedProcess } from "./signed-release-https-fixture.mjs";

const args = process.argv.slice(2);
const retainFixture = args.includes("--retain-fixture");
const [executable, output] = args
	.filter((value) => value !== "--retain-fixture")
	.map((v) => resolve(v));
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
const journal = JSON.parse(readFileSync(join(home, "updates/state.json")));
journal.transaction = {
	id: "controlled-startup-contention",
	candidate,
	staged: { candidate, executable, previousExecutable: executable },
	previous: b,
	revision: journal.revision,
	phase: "starting",
	switchStarted: true,
	startedAt: new Date().toISOString(),
};
writeFileSync(join(home, "updates/state.json"), jsonBytes(journal));
const expectedJournal = readFileSync(join(home, "updates/state.json"));
writeFileSync(join(home, "config.json"), jsonBytes({ repositories: [] }));
const lock = join(home, "updates/state.lock");
writeFileSync(lock, String(process.pid), { flag: "wx" });
let stderr = "",
	stdout = "";
const child = spawn(
	executable,
	["--home", home, "--port", "19691", "--no-open", "local"],
	{
		env,
		stdio: ["ignore", "pipe", "pipe"],
		detached: process.platform !== "win32",
	},
);
child.stdout.on("data", (b) => (stdout += b));
child.stderr.on("data", (b) => (stderr += b));
const closeEvent = new Promise((resolve) =>
	child.once("close", (code, signal) => resolve([code, signal])),
);
const close = closeEvent.then(([code, signal]) => ({ code, signal }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let healthy = false,
	journalUnchanged = false,
	exit,
	passed = false;
let receipt;
try {
	// Hold the exact live caller's lock across worker ownership and FactoryServer
	// construction. Remove only our own unchanged record after the bounded hold.
	for (let n = 0; n < 100 && !workerOwner(home) && child.exitCode === null; n++)
		await wait(20);
	await wait(500);
	assert.equal(readFileSync(lock, "utf8"), String(process.pid));
	rmSync(lock);
	for (let n = 0; n < 100 && child.exitCode === null; n++) {
		try {
			if ((await fetch("http://localhost:19691/api/auth/status")).ok) {
				healthy = true;
				break;
			}
		} catch {}
		await wait(50);
	}
	journalUnchanged = readFileSync(join(home, "updates/state.json")).equals(
		expectedJournal,
	);
	if (healthy)
		assert.equal(
			journalUnchanged,
			true,
			"Startup must preserve the supervisor transaction bytes",
		);
	exit = { code: child.exitCode, signal: child.signalCode };
} finally {
	const processCleanup =
		child.exitCode === null && child.signalCode === null
			? await terminateOwnedProcess(child, closeEvent, {
					detached: process.platform !== "win32",
					termGraceMs: 1000,
					killWaitMs: 2000,
				})
			: await close.then(({ code, signal }) => ({
					code,
					signal,
					forcedKill: false,
					closeTimedOut: false,
				}));
	const owner = workerOwner(home);
	const ownerStopped = !owner || !ownerAlive(owner);
	passed =
		healthy &&
		journalUnchanged &&
		ownerStopped &&
		!processCleanup.closeTimedOut;
	// Retain diagnosis without enrollment codes or any credential material.
	const error = stderr
		.split("\n")
		.filter((l) =>
			/Fatal error|Update settings|at change|at observeInstalled|at new FactoryServer/.test(
				l,
			),
		);
	receipt = {
		sourceCommit: b.commit,
		target: b.target,
		executableSha256: b.executable.sha256,
		harnessSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
		home,
		healthy,
		journalUnchanged,
		exit,
		processCleanup,
		ownerStopped,
		error,
		passed,
		purpose:
			"native replacement startup under bounded live updater state-lock contention",
	};
	writeFileSync(output, jsonBytes(receipt));
	if (!retainFixture) {
		try {
			receipt.fixtureCleanup = cleanupFixtureTreeAfterReceipt({
				work,
				receiptPath: output,
			});
			if (
				!receipt.fixtureCleanup.removed &&
				receipt.fixtureCleanup.reason !== "receipt-inside-fixture"
			)
				passed = false;
		} catch (error) {
			receipt.fixtureCleanup = { removed: false, reason: "cleanup-error" };
			receipt.cleanupError = error.stack;
			passed = false;
		}
	} else {
		receipt.fixtureCleanup = { removed: false, reason: "retain-fixture" };
	}
	receipt.passed = passed;
	writeFileSync(output, jsonBytes(receipt));
}
assert.equal(
	receipt?.passed,
	true,
	"Native replacement startup or bounded cleanup failed; inspect contention receipt",
);
