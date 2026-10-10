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
import { cleanupFixtureTreeAfterReceipt } from "./signed-delivery-harness-lifecycle.mjs";
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
