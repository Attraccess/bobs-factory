import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { trialBootstrapFixture } from "./trial-bootstrap-fixture.mjs";

const port = 52000 + (process.pid % 10000);

function launch(f, args = [], release) {
	if (release)
		writeFileSync(
			f.packageJson,
			JSON.stringify({
				name: "bobs-factory-trial-test",
				type: "module",
				factoryRelease: release,
			}),
		);
	const child = spawn(process.execPath, [f.launcher, ...args], {
		env: f.env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let output = "";
	child.stdout.on("data", (data) => (output += data));
	child.stderr.on("data", (data) => (output += data));
	const closed = new Promise((resolve) =>
		child.once("close", (code, signal) => resolve({ code, signal })),
	);
	return { child, closed, output: () => output };
}

async function waitFor(check, label, timeoutMs = 2500) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (check()) return;
		await delay(25);
	}
	throw new Error(`Timed out waiting for ${label}`);
}

test("explicit stable channel reaches the signed bootstrap and rejects beta", {
	timeout: 30000,
}, async () => {
	const f = trialBootstrapFixture("1.0.0-beta");
	try {
		const run = launch(f, [
			"--channel",
			"stable",
			"--version",
			"1.0.0-beta",
			"--port",
			String(port),
			"--no-open",
		]);
		const result = await run.closed;
		assert.notEqual(result.code, 0, run.output());
		assert.match(
			run.output(),
			/Requested channel does not match the signed version/,
		);
		assert.equal(
			existsSync(join(f.home, ".bobs-factory-trial/.launcher-lock")),
			false,
		);
	} finally {
		f.cleanup();
	}
});

test("unbound default selection retains the authenticated beta fallback", {
	timeout: 30000,
}, async () => {
	const f = trialBootstrapFixture("1.0.0-beta");
	try {
		const run = launch(f, ["--port", String(port + 4), "--no-open"]);
		const result = await run.closed;
		assert.equal(result.code, 0, run.output());
		assert.match(run.output(), /verified beta/);
		assert.match(run.output(), /runtime-1\.0\.0-beta/);
	} finally {
		f.cleanup();
	}
});

for (const release of [
	{ version: "1.0.0", channel: "stable" },
	{ version: "1.0.0-nightly.20261009.1", channel: "nightly" },
])
	test(`generated ${release.channel} package identity reaches the signed bootstrap`, {
		timeout: 30000,
	}, async () => {
		const f = trialBootstrapFixture(release.version);
		try {
			const run = launch(f, ["--port", String(port + 1), "--no-open"], release);
			const result = await run.closed;
			assert.equal(result.code, 0, run.output());
			assert.match(
				run.output(),
				new RegExp(`runtime-${release.version.replaceAll(".", "\\.")}`),
			);
			assert.equal(
				existsSync(join(f.home, ".bobs-factory-trial/.launcher-lock")),
				false,
			);
			assert.deepEqual(
				readdirSync(f.temp).filter((name) =>
					name.startsWith("bobs-factory-trial-"),
				),
				[],
			);
		} finally {
			f.cleanup();
		}
	});

test("TERM during bootstrap download stops its owned process group before cleanup", {
	timeout: 10000,
}, async () => {
	const f = trialBootstrapFixture("1.0.0", { slowCurl: true });
	let run;
	try {
		run = launch(f, ["--port", String(port + 2), "--no-open"]);
		await waitFor(() => existsSync(f.curlPid), "controlled curl child");
		const curlPid = Number(readFileSync(f.curlPid, "utf8"));
		run.child.kill("SIGTERM");
		const result = await Promise.race([
			run.closed,
			delay(7000).then(() => {
				throw new Error(
					`Launcher did not exit after TERM. Output: ${run.output()}`,
				);
			}),
		]);
		assert.equal(result.code, 143, run.output());
		assert.throws(() => process.kill(curlPid, 0), { code: "ESRCH" });
		assert.equal(
			existsSync(join(f.home, ".bobs-factory-trial/.launcher-lock")),
			false,
		);
		assert.deepEqual(
			readdirSync(f.temp).filter((name) =>
				name.startsWith("bobs-factory-trial-"),
			),
			[],
		);
	} finally {
		if (run && run.child.exitCode === null) run.child.kill("SIGKILL");
		f.cleanup();
	}
});

test("npm exits after TERM reaches a packed launcher during bootstrap download", {
	timeout: 20000,
}, async () => {
	const f = trialBootstrapFixture("1.0.0", { slowCurl: true });
	let npm;
	try {
		const packed = JSON.parse(
			execFileSync("npm", ["pack", "--json", "--pack-destination", f.work], {
				cwd: f.packageDir,
				encoding: "utf8",
			}),
		)[0];
		npm = spawn(
			"npm",
			[
				"exec",
				"--offline",
				"--yes",
				"--cache",
				join(f.work, "npm-cache"),
				"--package",
				join(f.work, packed.filename),
				"--",
				"bobs-factory-trial",
				"--port",
				String(port + 3),
				"--no-open",
			],
			{ env: f.env, stdio: ["ignore", "pipe", "pipe"] },
		);
		let output = "";
		npm.stdout.on("data", (data) => (output += data));
		npm.stderr.on("data", (data) => (output += data));
		const closed = new Promise((resolve) =>
			npm.once("close", (code, signal) => resolve({ code, signal })),
		);
		await waitFor(
			() => existsSync(f.curlPid),
			"packed launcher's controlled download",
			15000,
		);
		const curlPid = Number(readFileSync(f.curlPid, "utf8"));
		const owner = JSON.parse(
			readFileSync(
				join(f.home, ".bobs-factory-trial/.launcher-lock/owner.json"),
				"utf8",
			),
		);
		process.kill(owner.pid, "SIGTERM");
		const result = await Promise.race([
			closed,
			delay(10000).then(() => {
				throw new Error(`npm did not exit after TERM. Output: ${output}`);
			}),
		]);
		assert.equal(result.code, 143, output);
		assert.throws(() => process.kill(curlPid, 0), { code: "ESRCH" });
		assert.equal(
			existsSync(join(f.home, ".bobs-factory-trial/.launcher-lock")),
			false,
		);
		assert.deepEqual(
			readdirSync(f.temp).filter((name) =>
				name.startsWith("bobs-factory-trial-"),
			),
			[],
		);
	} finally {
		if (npm && npm.exitCode === null) npm.kill("SIGKILL");
		f.cleanup();
	}
});
