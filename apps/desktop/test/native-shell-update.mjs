// Linux-only actual packaged AppImage + native Factory worker. Controlled RSA
// publisher/transport and simulated outer release evidence, no OS/provider claim.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
	closeSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { WorkflowRuntime } from "../../../packages/edge-worker/dist/factory/WorkflowRuntime.js";
import { MachineCapacity } from "../../../packages/edge-worker/dist/MachineCapacity.js";
import { freezeCandidate } from "../../../scripts/lib/release-candidate.mjs";
import {
	DesktopAppLifecycle,
	processStamp,
	read,
	save,
} from "../src/app-lifecycle.mjs";
import { DesktopAppSource } from "../src/app-source.mjs";
import * as services from "../src/update-services.mjs";
import { appRelease, fixtureClient, keys } from "./shell-fixture.mjs";

assert.equal(
	process.platform,
	"linux",
	"This fixture never bypasses macOS signing/notarization",
);
const [imageArgument, runtimeArgument, candidateArgument] =
	process.argv.slice(2);
if (!imageArgument || !runtimeArgument || !candidateArgument)
	throw Error("APPIMAGE RUNTIME_DIRECTORY CANDIDATE_JSON required");
const image = resolve(imageArgument),
	native = resolve(runtimeArgument),
	frozen = read(candidateArgument),
	target = `linux-${process.arch}`,
	root = mkdtempSync(join(tmpdir(), "native-shell-")),
	home = join(root, "home"),
	install = join(root, "Bob.AppImage"),
	port = 3989;
mkdirSync(home);
process.env.HOME = join(root, "os-home");
mkdirSync(process.env.HOME);
process.env.APPIMAGE_EXTRACT_AND_RUN = "1";
cpSync(image, install);
const app = resolve("apps/desktop"),
	priorOutput = join(root, "prior");
// Build a distinct previous shell candidate from the same frozen source with an
// older test version, retaining the same matching native runtime. Not a release.
const prior = freezeCandidate({
	channel: "stable",
	version: "0.9.0",
	commit: frozen.candidate.commit,
	workflowSha: frozen.candidate.workflowSha,
	committedVersion: frozen.candidate.committedVersion,
	promotion: {
		channel: "nightly",
		version: frozen.candidate.version,
		tag: `v${frozen.candidate.version}`,
		commit: frozen.candidate.commit,
		manifestSha256: "a".repeat(64),
		releaseId: 1,
	},
	date: "2026-10-10T00:00:00Z",
});
function buildVariant(record, output, file) {
	cpSync(native, join(app, "runtime"), { recursive: true });
	writeFileSync(
		join(app, "desktop-identity.json"),
		JSON.stringify({
			version: record.candidate.version,
			commit: record.candidate.commit,
			target,
		}),
	);
	try {
		execFileSync(
			"pnpm",
			[
				"exec",
				"electron-builder",
				"--linux",
				"AppImage",
				`--${process.arch}`,
				"--publish",
				"never",
				`--config.directories.output=${output}`,
				`--config.extraMetadata.version=${record.candidate.version}`,
				`--config.artifactName=${file}`,
			],
			{
				cwd: app,
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
			},
		);
	} finally {
		rmSync(join(app, "runtime"), { recursive: true, force: true });
		rmSync(join(app, "desktop-identity.json"), { force: true });
	}
}
buildVariant(prior, priorOutput, "previous.AppImage");
const failedCandidate = freezeCandidate({
	channel: "nightly",
	commit: frozen.candidate.commit,
	workflowSha: frozen.candidate.workflowSha,
	committedVersion: frozen.candidate.committedVersion,
	sequence: Number(frozen.candidate.version.split(".").at(-1)) + 1,
	date: `${frozen.candidate.version
		.match(/nightly\.(\d{4})(\d{2})(\d{2})\./)
		.slice(1)
		.join("-")}T00:00:00Z`,
});
const failedOutput = join(root, "failed");
buildVariant(failedCandidate, failedOutput, "failed.AppImage");
cpSync(join(priorOutput, "previous.AppImage"), install);
const old = appRelease("stable", readFileSync(install), target, {
		frozenCandidate: prior,
	}),
	good = appRelease("nightly", readFileSync(image), target, {
		frozenCandidate: frozen,
	}),
	bad = appRelease(
		"nightly",
		readFileSync(join(failedOutput, "failed.AppImage")),
		target,
		{ frozenCandidate: failedCandidate },
	);
// Create retained waiting state before native worker startup; no runner invoked.
const seed = new WorkflowRuntime(home, {
	agent: async () => {
		throw Error("No provider permitted");
	},
	script: async () => ({}),
	tool: async () => ({}),
});
const run = seed.create({
	id: "native-shell-wait",
	title: "Retained shell checkpoint",
	repositoryId: "fixture",
	workspace: root,
	input: "fixture",
	triggerOrigin: {
		type: "manual",
		workflowId: "fixture",
		at: new Date().toISOString(),
	},
	workflow: {
		id: "fixture",
		name: "Fixture",
		allowedTriggers: ["manual"],
		steps: [
			{
				id: "ask",
				name: "Ask",
				type: "agent",
				prompt: "Mock",
				askQuestions: true,
				next: "end",
			},
		],
	},
});
run.status = "waiting";
run.questions = ["Retained question"];
run.questionBatchId = "fixture-batch";
run.checkpoint = {
	step: "ask",
	agent: { runner: "codex", sessionId: "mock-native-shell-checkpoint" },
};
seed.save(run);
await seed.shutdown();
const saved = readFileSync(join(home, "factory", "runs", `${run.id}.json`));
const env = {
	...process.env,
	APPIMAGE_EXTRACT_AND_RUN: "1",
	BOBS_FACTORY_DESKTOP_HOME: home,
	BOBS_FACTORY_DESKTOP_PORT: String(port),
};
const worker = spawn(
	join(native, "bobs-factory"),
	["--home", home, "--port", String(port), "--no-open", "local"],
	{ env: { ...env, BOBS_FACTORY_DESKTOP_OWNER: "1" }, stdio: "ignore" },
);
const until = async (check) => {
	const deadline = Date.now() + 30000;
	while (!(await check())) {
		assert.ok(Date.now() < deadline, "Native shell wait timed out");
		await new Promise((r) => setTimeout(r, 100));
	}
};
await until(async () => {
	try {
		return (
			(await fetch(`http://localhost:${port}/api/version`)).ok &&
			services.workerOwner(home)
		);
	} catch {
		return false;
	}
});
const owned = services.workerOwner(home),
	directory = join(home, "desktop", "updates"),
	controlled = { ...services, trustedKeys: keys },
	source = new DesktopAppSource(
		directory,
		install,
		target,
		controlled,
		fixtureClient([old, good], services),
		keys,
	);
save(
	join(directory, "installation.json"),
	await source.enroll({ ...old.identity, target }),
);
const bootManager = new services.UpdateManager(
	join(home, "desktop"),
	source,
	undefined,
	{ ...old.identity, target },
);
bootManager.configure({}, 0);
save(bootManager.file, {
	...read(bootManager.file),
	nextCheckAt: Date.now() + 3600000,
});
const ui = spawn(install, ["--no-sandbox"], { env, stdio: "ignore" });
await new Promise((r, j) => {
	ui.once("spawn", r);
	ui.once("error", j);
});
await until(() => existsSync(join(directory, "ui-session.json")));
const uiIdentity = read(join(directory, "ui-session.json"));
assert.equal(uiIdentity.identity.version, prior.candidate.version);
const life = new DesktopAppLifecycle(
		{
			home,
			install,
			target,
			port,
			uiPid: uiIdentity.pid,
			uiStamp: uiIdentity.stamp,
			launchArgs: ["--no-sandbox"],
		},
		controlled,
	),
	manager = new services.UpdateManager(join(home, "desktop"), source, life, {
		...old.identity,
		target,
	});
const capacity = new MachineCapacity(2, join(home, "machine-capacity"));
await capacity.ready();
let candidatePid;
try {
	manager.configure({ channel: "nightly" }, manager.status().revision);
	await manager.check();
	await manager.stage();
	const lease = await capacity.acquireLease(undefined, {
		identity: "native-shell-active",
	});
	await manager.reconcile();
	assert.equal(manager.status().transaction.phase, "cancelled");
	assert.equal(services.workerOwner(home).pid, owned.pid);
	assert.equal(processStamp(uiIdentity.pid), life.uiStamp);
	await lease.release();
	// The actual main.mjs reads its exact quit ticket, exits, and the production
	// lifecycle launches/health-checks the replacement actual packaged Electron.
	const retained = join(root, "external-helper");
	mkdirSync(retained);
	for (const file of [
		"app-helper.mjs",
		"app-lifecycle.mjs",
		"app-source.mjs",
		"app-archive.mjs",
	])
		cpSync(join(app, "src", file), join(retained, file));
	// Only this isolated test module supplies the generated public RSA key. The
	// installed product has no test-key flag, trust override or OS signing bypass.
	writeFileSync(
		join(retained, "update-services.mjs"),
		`export * from ${JSON.stringify(pathToFileURL(join(app, "src", "update-services.mjs")).href)};\nexport const trustedKeys = ${JSON.stringify(keys)};\n`,
	);
	const request = join(retained, "request.json");
	save(request, {
		home,
		install,
		target,
		port,
		directory,
		identity: { ...old.identity, target },
		uiPid: uiIdentity.pid,
		uiStamp: uiIdentity.stamp,
		launchArgs: ["--no-sandbox"],
	});
	const log = openSync(join(root, "helper.log"), "a");
	const helper = spawn(
		join(app, "node_modules", "electron", "dist", "electron"),
		[join(retained, "app-helper.mjs"), request],
		{ env: { ...env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", log, log] },
	);
	closeSync(log);
	const helperExit = await new Promise((r, j) => {
		helper.once("exit", r);
		helper.once("error", j);
	});
	assert.equal(helperExit, 0, readFileSync(join(root, "helper.log"), "utf8"));
	assert.equal(
		manager.status().transaction.phase,
		"succeeded",
		JSON.stringify(manager.status().transaction),
	);
	candidatePid = read(manager.status().transaction.snapshot).child.pid;
	assert.equal(services.workerOwner(home).pid, owned.pid);
	assert.equal(services.workerOwner(home).nonce, owned.nonce);
	assert.deepEqual(
		readFileSync(join(home, "factory", "runs", `${run.id}.json`)),
		saved,
	);
	// A separately built, newer actual shell fails health deliberately. Preserve
	// truthful installed identity and restore the retained successful UI bytes.
	life.uiPid = candidatePid;
	life.uiStamp = processStamp(candidatePid);
	source.client = fixtureClient([old, bad], services);
	life.health = async (candidate) => {
		await DesktopAppLifecycle.prototype.health.call(life, candidate);
		if (candidate.version === failedCandidate.candidate.version)
			throw Error("Controlled candidate health failure");
	};
	await manager.check();
	await manager.stage();
	await manager.reconcile();
	assert.equal(manager.status().transaction.phase, "rolled-back");
	assert.equal(services.workerOwner(home).pid, owned.pid);
	assert.deepEqual(
		readFileSync(join(home, "factory", "runs", `${run.id}.json`)),
		saved,
	);
	assert.equal(manager.status().badCandidates.length, 1);
	console.log(
		JSON.stringify(
			{
				status: "passed",
				scope:
					"actual unsigned AppImage/Electron and native worker; controlled test-only RSA release and simulated outer release evidence; Xvfb --no-sandbox; no real provider or Apple signing",
				version: frozen.candidate.version,
				commit: frozen.candidate.commit,
				target,
				candidateDigest: frozen.digest,
				imageSha256: good.manifest.desktop.artifacts[0].updateArchive.sha256,
				workerPidUnchanged: true,
				checks: [
					"active-lease deferral",
					"actual external Electron Node-mode helper entry",
					"actual Electron exit before complete-app replacement",
					"actual candidate health identity",
					"same native worker PID/nonce",
					"waiting workflow checkpoint byte preservation",
					"actual candidate stop before rollback",
					"failed candidate suppression",
				],
			},
			null,
			2,
		),
	);
} finally {
	for (const path of [join(directory, "state.json")])
		if (existsSync(path)) {
			const t = read(path).transaction;
			if (t?.snapshot && existsSync(t.snapshot)) {
				const s = read(t.snapshot);
				if (s.child?.stamp && processStamp(s.child.pid) === s.child.stamp)
					try {
						process.kill(s.child.pid, "SIGTERM");
					} catch {}
			}
		}
	if (candidatePid)
		try {
			process.kill(candidatePid, "SIGTERM");
		} catch {}
	try {
		process.kill(ui.pid, "SIGTERM");
	} catch {}
	worker.kill("SIGTERM");
	await capacity.shutdown();
	old.cleanup();
	good.cleanup();
	bad.cleanup();
	// Retain the isolated root for receipt/failed-process inspection, never prune
	// a production home. The native process owner is stopped by this fixture only.
}
