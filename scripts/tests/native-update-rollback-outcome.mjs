// Regression for packaged startup identity after rollback completed but its
// maintenance-release acknowledgment was lost. The executable is run in two
// isolated homes: as the retained previous runtime (healthy) and as the rejected
// candidate (must fail before serving). No service registration or credentials.
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
const executable = resolve(executableArg);
const output = resolve(outputArg);
const work = mkdtempSync(join(tmpdir(), "bobs-rollback-outcome-"));
const build = JSON.parse(readFileSync(join(dirname(executable), "build.json")));
const env = { PATH: process.env.PATH, HOME: work, TMPDIR: work };
const previousOther = {
	version: "0.0.1",
	commit: "a".repeat(40),
	target: build.target,
};
const candidateForWrongRuntime = {
	version: build.version,
	commit: build.commit,
	target: build.target,
	channel: build.version.includes("nightly") ? "nightly" : "stable",
	manifestSha256: sha256("rollback outcome candidate"),
	publishedAt: "2026-10-10T18:00:00.000Z",
};
const previousRuntime = {
	version: build.version,
	commit: build.commit,
	target: build.target,
};
const candidateForCorrectRuntime = {
	...candidateForWrongRuntime,
	version: "2.0.0",
	commit: "b".repeat(40),
};

async function unusedPort() {
	const listener = createServer();
	await new Promise((done) => listener.listen(0, "127.0.0.1", done));
	const port = listener.address().port;
	await new Promise((done) => listener.close(done));
	return port;
}

async function run({ name, candidate, previous, expectedHealthy }) {
	const home = join(work, name);
	mkdirSync(home);
	const manager = new UpdateManager(home, undefined, undefined, build);
	manager.configure({ channel: candidate.channel }, 0);
	const stateFile = join(home, "updates/state.json");
	const state = JSON.parse(readFileSync(stateFile, "utf8"));
	state.installed = previous;
	state.transaction = {
		id: `rollback-outcome-${name}`,
		candidate,
		staged: { candidate, executable, previousExecutable: executable },
		previous,
		revision: state.revision,
		phase: "recovery-required",
		release: {
			transactionId: `rollback-outcome-${name}`,
			outcome: "rolled-back",
			status: "pending",
		},
		switchStarted: true,
		startedAt: new Date().toISOString(),
	};
	writeFileSync(stateFile, jsonBytes(state));
	writeFileSync(join(home, "config.json"), jsonBytes({ repositories: [] }));
	const before = readFileSync(stateFile, "utf8");
	const port = await unusedPort();
	let stderr = "";
	const child = spawn(
		executable,
		["--home", home, "--port", String(port), "--no-open", "local"],
		{ env, stdio: ["ignore", "pipe", "pipe"] },
	);
	// Startup logs can contain one-time local enrollment codes. Never retain them.
	child.stdout.on("data", () => {});
	child.stderr.on("data", (chunk) => (stderr += chunk));
	const closed = new Promise((done) =>
		child.once("close", (code, signal) => done({ code, signal })),
	);
	const wait = (ms) => new Promise((done) => setTimeout(done, ms));
	let healthy = false;
	try {
		for (let n = 0; n < 100 && child.exitCode === null; n++) {
			try {
				if ((await fetch(`http://127.0.0.1:${port}/api/auth/status`)).ok) {
					healthy = true;
					break;
				}
			} catch {}
			await wait(50);
		}
		assert.equal(
			healthy,
			expectedHealthy,
			`${name} runtime health mismatch; inspect native startup logs`,
		);
		if (expectedHealthy) child.kill("SIGTERM");
		const exit = await closed;
		assert.equal(readFileSync(stateFile, "utf8"), before);
		return {
			name,
			expectedHealthy,
			healthy,
			exit,
			stateUnchanged: true,
			startupError: stderr
				.split("\n")
				.filter((line) => /Fatal error|outcome rolled-back/.test(line)),
		};
	} finally {
		if (child.exitCode === null) child.kill("SIGTERM");
		await closed;
	}
}

try {
	const rejectedCandidate = await run({
		name: "wrong-candidate",
		candidate: candidateForWrongRuntime,
		previous: previousOther,
		expectedHealthy: false,
	});
	const acceptedPrevious = await run({
		name: "correct-previous",
		candidate: candidateForCorrectRuntime,
		previous: previousRuntime,
		expectedHealthy: true,
	});
	writeFileSync(
		output,
		jsonBytes({
			sourceCommit: build.commit,
			target: build.target,
			executableSha256: build.executable.sha256,
			outcome: "rolled-back",
			pendingReleaseAcknowledgment: true,
			checks: [rejectedCandidate, acceptedPrevious],
			passed: true,
		}),
	);
} finally {
	rmSync(work, { recursive: true, force: true });
}
