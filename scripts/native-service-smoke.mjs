// Only disposable GitHub native runners may exercise actual user managers.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { desktopExecutable } from "../apps/desktop/src/local-runtime.mjs";

assert.equal(
	process.env.GITHUB_ACTIONS,
	"true",
	"Use a disposable native runner; never modify a developer service",
);
const runtime = process.argv[2];
assert(runtime);
const home = realpathSync(
	mkdtempSync(join(tmpdir(), "factory-native-service-")),
);
const executable = desktopExecutable(home, runtime);
const args = ["--home", home, "--port", "19571", "--no-open", "service"];
const command = (...operation) =>
	execFileSync(executable, [...args, ...operation], {
		encoding: "utf8",
		timeout: 60000,
	});
const status = () => JSON.parse(command("status"));
const until = async (predicate) => {
	for (let n = 0; n < 450; n++) {
		const s = status();
		if (predicate(s)) return s;
		await new Promise((r) => setTimeout(r, 100));
	}
	assert.fail("Native user manager did not reach required owned state");
};
let installed = false;
try {
	command("install", "--executable", executable, "--mode", "local");
	installed = true;
	assert.equal(status().desired, "stopped");
	assert.equal(status().startup, false);
	command("enable");
	assert.equal(status().startup, true);
	command("disable");
	assert.equal(status().startup, false);
	command("start");
	const initial = await until((s) => s.healthy);
	assert.equal(initial.owner.dashboardPort, 19571);
	process.kill(initial.owner.pid, "SIGKILL");
	const recovered = await until(
		(s) => s.healthy && s.owner.pid !== initial.owner.pid,
	);
	command("maintenance");
	assert.equal(status().desired, "maintenance");
	assert.throws(() => command("start"), /maintenance/);
	command("resume");
	await until((s) => s.healthy);
	command("stop");
	assert.equal(status().desired, "stopped");
	assert.equal(status().owner, null);
	command("restart");
	await until((s) => s.healthy);
	command("stop");
	command("remove");
	installed = false;
	assert.equal(status().installed, false);
	console.log(
		JSON.stringify({
			passed: true,
			home,
			platform: process.platform,
			initialPid: initial.owner.pid,
			recoveredPid: recovered.owner.pid,
			assertions: [
				"opt-in install",
				"enable/disable",
				"manager PID and executable/home health",
				"crash backoff restart",
				"maintenance suppression/resume",
				"deliberate Stop",
				"restart",
				"retained remove",
			],
			notValidated: [
				"login/logout/reboot",
				"remote host",
				"physical passkey",
				"signed publication",
			],
		}),
	);
} finally {
	if (installed) {
		try {
			command("stop");
			command("remove");
		} catch (error) {
			console.error(
				"Fixture cleanup requires retained native-manager inspection:",
				error.message,
			);
		}
	}
}
