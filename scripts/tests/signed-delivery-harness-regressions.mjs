import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { jsonBytes, sha256 } from "../lib/binary-release.mjs";
import {
	cleanupFixtureTreeAfterReceipt,
	finalizeFixtureReceipt,
} from "./signed-delivery-harness-lifecycle.mjs";
import { command } from "./signed-release-https-fixture.mjs";

const [outputArg] = process.argv.slice(2);
assert(
	outputArg,
	"Usage: node signed-delivery-harness-regressions.mjs RECEIPT",
);
const output = resolve(outputArg);
mkdirSync(dirname(output), { recursive: true });
const tempRoot = mkdtempSync(
	join(tmpdir(), "bobs-signed-harness-regressions-"),
);
const results = [];
const unrelated = spawn(
	process.execPath,
	["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
	{ detached: true, stdio: "ignore" },
);
const unrelatedClose = once(unrelated, "close");
let receipt;
let cleanupError;
const record = (name, details) => {
	results.push({ name, passed: true, ...details });
	console.log(`PASS ${name}`);
};

try {
	const startedAt = Date.now();
	const stopped = await command(
		process.execPath,
		[
			"-e",
			"const {spawn}=require('node:child_process'); const descendant=spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});setInterval(()=>{},1000);\"],{stdio:'ignore'}); console.log(descendant.pid); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);",
		],
		{ timeout: 100, termGraceMs: 100, killWaitMs: 2000 },
	);
	const elapsedMs = Date.now() - startedAt;
	const descendantPid = Number(stopped.stdout.trim());
	assert.equal(stopped.timedOut, true);
	assert.equal(stopped.forcedKill, true);
	assert.equal(stopped.closeTimedOut, false);
	assert.equal(stopped.signal, "SIGKILL");
	assert.notEqual(
		stopped.code,
		0,
		"Forced termination must not appear as success",
	);
	assert(elapsedMs < 5000, `Termination exceeded bound: ${elapsedMs}ms`);
	assert.throws(() => process.kill(stopped.pid, 0), { code: "ESRCH" });
	assert(Number.isInteger(descendantPid) && descendantPid > 0);
	for (let n = 0; n < 60; n++) {
		try {
			process.kill(descendantPid, 0);
		} catch (error) {
			if (error.code === "ESRCH") break;
			throw error;
		}
		if (n === 59)
			throw Error("Owned descendant survived process-group cleanup");
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
	record("TERM-ignoring child is escalated and reaped within a bound", {
		elapsedMs,
		result: {
			code: stopped.code,
			signal: stopped.signal,
			timedOut: stopped.timedOut,
			forcedKill: stopped.forcedKill,
			closeTimedOut: stopped.closeTimedOut,
			descendantPid,
			unrelatedProcessPreserved: true,
		},
	});

	const leaderExitStartedAt = Date.now();
	const leaderExit = await command(
		process.execPath,
		[
			"-e",
			`
		const {spawn} = require('node:child_process');
		process.on('SIGTERM', () => process.exit(0));
		const descendant = spawn(process.execPath, ['-e',
			"process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000);"
		], {stdio:['ignore','ignore','ignore','ipc']});
		descendant.once('message', () => console.log(descendant.pid));
		setInterval(()=>{},1000);
	`,
		],
		{ timeout: 500, termGraceMs: 150, killWaitMs: 2000 },
	);
	const leaderExitElapsedMs = Date.now() - leaderExitStartedAt;
	const survivingPid = Number(leaderExit.stdout.trim());
	assert(Number.isInteger(survivingPid) && survivingPid > 0);
	assert.equal(leaderExit.timedOut, true);
	assert.equal(
		leaderExit.code,
		124,
		"TERM-responsive leader cannot make timeout successful",
	);
	assert.equal(leaderExit.signal, null);
	assert.equal(
		leaderExit.forcedKill,
		true,
		"Surviving descendant requires escalation after leader closes",
	);
	assert.equal(leaderExit.closeTimedOut, false);
	assert(leaderExitElapsedMs < 5000);
	assert.throws(() => process.kill(leaderExit.pid, 0), { code: "ESRCH" });
	assert.throws(() => process.kill(survivingPid, 0), { code: "ESRCH" });
	assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
	record(
		"exited TERM-responsive leader still escalates its TERM-ignoring descendant",
		{
			elapsedMs: leaderExitElapsedMs,
			result: {
				code: leaderExit.code,
				signal: leaderExit.signal,
				timedOut: leaderExit.timedOut,
				forcedKill: leaderExit.forcedKill,
				closeTimedOut: leaderExit.closeTimedOut,
				descendantPid: survivingPid,
				unrelatedProcessPreserved: true,
			},
		},
	);

	for (const passed of [true, false]) {
		const work = mkdtempSync(
			join(tmpdir(), "bobs-signed-integration-cleanup-"),
		);
		const home = join(work, "home");
		mkdirSync(home);
		writeFileSync(join(home, "fixture-marker"), "owned fixture\n");
		const receiptPath = join(
			tempRoot,
			`${passed ? "success" : "failure"}.json`,
		);
		writeFileSync(receiptPath, jsonBytes({ passed, home }));
		const cleanup = cleanupFixtureTreeAfterReceipt({ work, receiptPath });
		assert.deepEqual(cleanup, { removed: true, reason: "receipt-written" });
		assert.equal(existsSync(work), false);
		assert.equal(JSON.parse(readFileSync(receiptPath, "utf8")).passed, passed);
		record(
			`owned temp HOME is removed after ${passed ? "success" : "failure"} receipt`,
			{
				fixtureReceiptPassed: passed,
				receiptPath,
			},
		);
	}

	const work = mkdtempSync(join(tmpdir(), "bobs-signed-integration-retain-"));
	const receiptInside = join(work, "receipt.json");
	writeFileSync(receiptInside, jsonBytes({ passed: false }));
	const retained = cleanupFixtureTreeAfterReceipt({
		work,
		receiptPath: receiptInside,
	});
	assert.deepEqual(retained, {
		removed: false,
		reason: "receipt-inside-fixture",
	});
	assert.equal(existsSync(receiptInside), true);
	rmSync(work, { recursive: true, force: true });
	record("receipt inside fixture is retained instead of deleted", retained);

	const failedCleanupWork = mkdtempSync(
		join(tmpdir(), "bobs-signed-integration-removal-failure-"),
	);
	const marker = join(failedCleanupWork, "fixture-marker");
	writeFileSync(marker, "owned fixture retained after failed removal\n");
	const failedReceiptPath = join(tempRoot, "removal-failure.json");
	const historicalReceiptPath = join(tempRoot, "historical.json");
	const historicalBytes = jsonBytes({ passed: true, historical: true });
	writeFileSync(historicalReceiptPath, historicalBytes);
	try {
		const failedProcess = await command(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				`
			import assert from 'node:assert/strict';
			import { readFileSync, realpathSync } from 'node:fs';
			import { cleanupFixtureTreeAfterReceipt, finalizeFixtureReceipt } from ${JSON.stringify(new URL("./signed-delivery-harness-lifecycle.mjs", import.meta.url).href)};
			const work = ${JSON.stringify(failedCleanupWork)};
			const receiptPath = ${JSON.stringify(failedReceiptPath)};
			const receipt = {passed:true, cleanupErrors:[]};
			finalizeFixtureReceipt({work, receiptPath, receipt,
				cleanupTree: (options) => cleanupFixtureTreeAfterReceipt({...options,
					removeTree: (path) => {
						assert.equal(JSON.parse(readFileSync(receiptPath,'utf8')).passed, true);
						assert.equal(path, realpathSync(work));
						throw Object.assign(new Error('Injected EACCES removing owned fixture'), {code:'EACCES'});
					}
				})
			});
			// Same failure guard as the runtime driver, after finalization.
			assert.equal(receipt.cleanupErrors.length, 0, receipt.cleanupErrors.join('\\n'));
		`,
			],
			{ timeout: 2000 },
		);
		assert.equal(failedProcess.code, 1);
		assert.equal(failedProcess.timedOut, false);
		assert.match(
			failedProcess.stderr,
			/Injected EACCES removing owned fixture/,
		);
		const written = JSON.parse(readFileSync(failedReceiptPath, "utf8"));
		assert.equal(written.passed, false);
		assert.deepEqual(written.fixtureCleanup, {
			removed: false,
			reason: "cleanup-failed",
		});
		assert.match(
			written.cleanupErrors[0],
			/Injected EACCES removing owned fixture/,
		);
		assert.equal(existsSync(marker), true);
		assert.deepEqual(readFileSync(historicalReceiptPath), historicalBytes);
		record(
			"injected removal exception rewrites this run's receipt as failed and retains diagnosis",
			{
				processExitCode: failedProcess.code,
				fixtureReceiptPassed: written.passed,
				fixtureCleanup: written.fixtureCleanup,
				cleanupError: written.cleanupErrors[0].split("\n")[0],
				historicalReceiptUnchanged: true,
				fixtureMarkerRetained: true,
			},
		);
	} finally {
		rmSync(failedCleanupWork, { recursive: true, force: true });
	}

	for (const reason of [
		"retain-fixture",
		"receipt-inside-fixture",
		"fixture-close-error",
	]) {
		const retainedWork = mkdtempSync(
			join(tmpdir(), "bobs-signed-integration-finalize-retain-"),
		);
		const receiptPath =
			reason === "receipt-inside-fixture"
				? join(retainedWork, "receipt.json")
				: join(tempRoot, `${reason}.json`);
		const closeError = new Error("Injected fixture close failure");
		const retainedReceipt = {
			passed: true,
			cleanupErrors: reason === "fixture-close-error" ? [closeError.stack] : [],
		};
		try {
			finalizeFixtureReceipt({
				work: retainedWork,
				receiptPath,
				receipt: retainedReceipt,
				retainFixture: reason === "retain-fixture",
			});
			const written = JSON.parse(readFileSync(receiptPath, "utf8"));
			assert.equal(existsSync(retainedWork), true);
			assert.equal(written.passed, reason !== "fixture-close-error");
			assert.equal(
				written.fixtureCleanup.reason,
				reason === "fixture-close-error" ? "active-owner-retained" : reason,
			);
			record(`receipt finalization preserves ${reason} semantics`, {
				fixtureReceiptPassed: written.passed,
				fixtureCleanup: written.fixtureCleanup,
			});
		} finally {
			rmSync(retainedWork, { recursive: true, force: true });
		}
	}

	const script = fileURLToPath(import.meta.url);
	const fixtureHelper = new URL(
		"./signed-release-https-fixture.mjs",
		import.meta.url,
	);
	const runtimeDriver = new URL(
		"./signed-delivery-runtime.mjs",
		import.meta.url,
	);
	const lifecycleHelper = new URL(
		"./signed-delivery-harness-lifecycle.mjs",
		import.meta.url,
	);
	receipt = {
		schemaVersion: 1,
		purpose:
			"TEST ONLY signed-delivery harness shutdown and fixture cleanup regressions",
		passed: results.every((result) => result.passed),
		harnesses: {
			regressionScriptSha256: sha256(readFileSync(script)),
			processFixtureSha256: sha256(readFileSync(fixtureHelper)),
			runtimeDriverSha256: sha256(readFileSync(runtimeDriver)),
			lifecycleHelperSha256: sha256(readFileSync(lifecycleHelper)),
		},
		results,
		limitations: [
			"No production binary or service was started.",
			"No provider, signing key, or native credential was used.",
		],
	};
	writeFileSync(output, jsonBytes(receipt));
	assert.equal(receipt.passed, true);
} finally {
	try {
		process.kill(-unrelated.pid, "SIGKILL");
	} catch (error) {
		if (error.code !== "ESRCH") cleanupError = error;
	}
	await Promise.race([
		unrelatedClose,
		new Promise((resolve) => setTimeout(resolve, 2000)),
	]);
	rmSync(tempRoot, { recursive: true, force: true });
}
if (cleanupError) {
	receipt.passed = false;
	receipt.cleanupError = cleanupError.stack;
	writeFileSync(output, jsonBytes(receipt));
}
assert.equal(receipt.passed, true, cleanupError?.message);
