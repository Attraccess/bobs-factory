// Native integration drive, not a publication gate. Build six local VERSIONs
// using the canonical builder first; see the matching F1 report for reproduction.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { localRepository } from "../../apps/cli/dist/src/onboarding.js";
import {
	assertInstallationProof,
	installationProof,
} from "../../apps/cli/dist/src/services/InstallationOwnership.js";
import {
	ownerAlive,
	workerOwner,
} from "../../apps/cli/dist/src/services/InstanceLock.js";
import { OwnedUpdateLifecycle } from "../../apps/cli/dist/src/services/OwnedUpdateLifecycle.js";
import { FactoryClient } from "../../apps/cli/dist/src/tui/client.js";
import { desktopExecutable } from "../../apps/desktop/src/local-runtime.mjs";
import { defaultWorkflows } from "../../packages/edge-worker/dist/factory/defaultWorkflows.js";
import { requestFactoryTerminalSession } from "../../packages/edge-worker/dist/factory/FactoryAuthOperator.js";
import { validateWorkflows } from "../../packages/edge-worker/dist/factory/Workflow.js";
import { WorkflowRuntime } from "../../packages/edge-worker/dist/factory/WorkflowRuntime.js";
import { MachineCapacity } from "../../packages/edge-worker/dist/MachineCapacity.js";
import { PublishedUpdateSource } from "../../packages/edge-worker/dist/updates/PublishedUpdateSource.js";
import {
	candidateKey,
	UpdateManager,
} from "../../packages/edge-worker/dist/updates/UpdateManager.js";
import { jsonBytes, sha256 } from "../lib/binary-release.mjs";
import {
	command,
	signedHttpsFixture,
} from "./signed-release-https-fixture.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const [builds, output] = process.argv.slice(2).map((v) => resolve(v));
assert(
	builds && output,
	"Usage: node scripts/tests/signed-delivery-runtime.mjs BUILDS RECEIPT_DIRECTORY",
);
mkdirSync(output, { recursive: true });
const work = realpathSync(
	mkdtempSync(join(tmpdir(), "bobs-signed-integration-")),
);
// Workers inherit ONLY this controlled environment, never host provider keys.
const path = process.env.PATH;
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, {
	PATH: path,
	HOME: join(work, "host-home"),
	TMPDIR: work,
	LANG: "en_US.UTF-8",
	F1_AGENT_MODE: "mock",
});
mkdirSync(process.env.HOME);
const env = { ...process.env };
const results = [];
let completed = false;
const harnessSha256 = sha256(readFileSync(fileURLToPath(import.meta.url)));
const buildsReceipt = [];
const liveHomes = new Set();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, message) {
	for (let n = 0; n < 200; n++) {
		if (await fn()) return;
		await wait(50);
	}
	throw Error(message);
}
async function check(name, fn) {
	try {
		const details = await fn();
		results.push({ name, passed: true, ...(details ? { details } : {}) });
		console.log(`PASS ${name}`);
	} catch (error) {
		results.push({ name, passed: false, error: error.stack });
		throw error;
	}
}
const settings = (channel = "nightly", pin) => ({
	channel,
	overrides: {},
	paused: false,
	...(pin ? { pin } : {}),
});
const f = await signedHttpsFixture(root, work, builds);
const n1 = f.add("1101"),
	n2 = f.add("1102"),
	n3 = f.add("1103"),
	stable = f.add("stable"),
	stable2 = f.add("stable2"),
	beta = f.add("beta");
const target = `${process.platform}-${process.arch}`;
function nativeDirectory(r) {
	return join(
		builds,
		`build-${r.selection}`,
		`bobs-factory-${r.manifest.version}-${target}`,
	);
}
const previous = JSON.parse(
	readFileSync(join(nativeDirectory(stable), "build.json")),
);
for (const r of [n1, n2, n3, stable, stable2, beta]) {
	const d = nativeDirectory(r),
		b = JSON.parse(readFileSync(join(d, "build.json")));
	assert.equal(
		sha256(readFileSync(join(d, "bobs-factory"))),
		b.executable.sha256,
	);
	buildsReceipt.push({
		version: b.version,
		commit: b.commit,
		candidateDigest: b.candidateDigest,
		workflowSha: b.workflowSha,
		target: b.target,
		bun: b.tooling.bun,
		executable: b.executable,
		archive: r.manifest.targets[target],
	});
}
const newSource = (
	home,
	executable = join(nativeDirectory(stable), "bobs-factory"),
	keys = f.keys,
) =>
	new PublishedUpdateSource(
		join(home, "stage"),
		executable,
		target,
		f.client,
		keys,
	);
const prefix = join(work, "shell-prefix"),
	home = join(work, "selected-home");
mkdirSync(home);
const cli = async (executable, args) => {
	const r = await command(executable, ["--home", home, ...args], { env });
	assert.equal(r.code, 0, r.stderr);
	return JSON.parse(r.stdout);
};
const install = async (r, args = [], installPrefix = prefix) => {
	f.pointer(r);
	return command(
		"sh",
		[
			f.installer,
			"--prefix",
			installPrefix,
			"--no-modify-path",
			"--home",
			home,
			...args,
		],
		{ env: { ...env, ...f.env }, timeout: 120000 },
	);
};
function sourceSnapshots(r) {
	return { files: new Map(r.files), manifest: structuredClone(r.manifest) };
}
async function altered(r, fn, run) {
	const saved = sourceSnapshots(r);
	try {
		await fn();
		await run();
	} finally {
		r.files.clear();
		for (const [k, v] of saved.files) r.files.set(k, v);
		Object.assign(r.manifest, saved.manifest);
	}
}
try {
	await check(
		"successful signed discovery, download, extraction and actual native version probe",
		async () => {
			f.show([n1, stable, beta]);
			const s = newSource(join(work, "source-success"));
			const c = await s.discover(settings(), previous);
			assert.equal(c.version, n1.manifest.version);
			assert.equal(c.manifestSha256, sha256(n1.files.get("release.json")));
			const staged = await s.stage(c);
			const b = JSON.parse(
				readFileSync(join(dirname(staged.executable), "build.json")),
			);
			assert.equal(b.commit, n1.manifest.commit);
			assert.equal(b.candidateDigest, n1.manifest.candidateDigest);
			for (const file of ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.txt"])
				assert.deepEqual(
					readFileSync(join(dirname(staged.executable), file)),
					readFileSync(join(nativeDirectory(n1), file)),
				);
			const probe = await command(
				staged.executable,
				["--home", join(work, "explicit-probe"), "--version"],
				{ env },
			);
			assert.equal(probe.code, 0, probe.stderr);
			assert.equal(probe.stdout.trim(), c.version);
			return {
				candidate: c,
				executableSha256: b.executable.sha256,
				noticesRetained: true,
			};
		},
	);
	await check(
		"explicit updater stable refuses beta; installer unbound default permits authenticated beta fallback",
		async () => {
			f.show([beta]);
			const s = newSource(join(work, "beta-source"));
			assert.equal(await s.discover(settings("stable"), previous), undefined);
			await assert.rejects(
				s.discover(settings("stable", beta.manifest.version), previous),
				/another channel/,
			);
			let r = await install(
				beta,
				["--channel", "stable", "--version", beta.manifest.version],
				join(work, "explicit-beta-prefix"),
			);
			assert.notEqual(r.code, 0);
			assert.match(r.stderr, /channel does not match/);
			r = await install(beta, [], join(work, "default-beta-prefix"));
			assert.equal(r.code, 0, r.stderr);
			assert.match(r.stdout, /beta/);
		},
	);
	const rejectedSource = newSource(join(work, "reject-source"));
	f.show([n1]);
	const candidate = await rejectedSource.discover(settings(), previous);
	await check("untrusted TEST signing pin is rejected", async () => {
		await assert.rejects(
			newSource(join(work, "untrusted"), undefined, {}).discover(
				settings("nightly", n1.manifest.version),
				previous,
			),
			/key|publisher/i,
		);
	});
	await check(
		"signed manifest tampering is rejected before extraction",
		async () =>
			altered(
				n1,
				() => {
					n1.files.set(
						"release.json",
						Buffer.concat([n1.files.get("release.json"), Buffer.from(" ")]),
					);
				},
				async () => {
					await assert.rejects(rejectedSource.stage(candidate), /signature/);
				},
			),
	);
	await check("missing signature is rejected before extraction", async () =>
		altered(
			n1,
			() => {
				n1.files.delete("release.json.sig");
			},
			async () => {
				await assert.rejects(
					rejectedSource.stage(candidate),
					/Missing signature/,
				);
			},
		),
	);
	await check("partial signed target inventory is rejected", async () =>
		altered(
			n1,
			() => {
				delete n1.manifest.targets["linux-arm64"];
				n1.resign();
			},
			async () => {
				await assert.rejects(
					rejectedSource.stage(candidate),
					/four release targets/,
				);
			},
		),
	);
	await check("missing immutable target asset is rejected", async () =>
		altered(
			n1,
			() => {
				n1.files.delete(n1.manifest.targets[target].archive);
			},
			async () => {
				await assert.rejects(
					rejectedSource.stage(candidate),
					/missing or conflicting/,
				);
			},
		),
	);
	await check(
		"tampered archive response cannot pass canonical byte checks",
		async () => {
			const transport = async (url, options) => {
				const response = await f.transport(url, options);
				if (String(url).endsWith(`${candidate.version}-${target}.tar.gz`))
					return new Response(Buffer.from("corrupted archive"));
				return response;
			};
			const { githubClient } = await import("../lib/github-release.mjs");
			const s = new PublishedUpdateSource(
				join(work, "bad-archive"),
				join(nativeDirectory(stable), "bobs-factory"),
				target,
				githubClient("", transport),
				f.keys,
			);
			await assert.rejects(s.stage(candidate), /checksum mismatch/);
		},
	);
	await check("candidate inventory identity mismatch is rejected", async () =>
		altered(
			n1,
			() => {
				const bad = structuredClone(n1.frozen);
				bad.digest = "f".repeat(64);
				const bytes = jsonBytes(bad);
				n1.files.set("candidate.json", bytes);
				const rec = n1.manifest.assets.find((a) => a.file === "candidate.json");
				rec.sha256 = sha256(bytes);
				rec.size = bytes.length;
				n1.resign();
			},
			async () => {
				await assert.rejects(
					rejectedSource.stage(candidate),
					/Candidate digest mismatch/,
				);
			},
		),
	);
	await check("wrong requested signed channel cannot be staged", async () => {
		await assert.rejects(
			rejectedSource.stage({ ...candidate, channel: "stable" }),
			/another channel/,
		);
	});
	await check(
		"real shell install hands explicit per-home channel/policy to actual native CLI",
		async () => {
			const r = await install(n1, [
				"--channel",
				"nightly",
				"--version",
				n1.manifest.version,
			]);
			assert.equal(r.code, 0, r.stderr);
			const state = await cli(join(prefix, "bin/bobs-factory"), [
				"update",
				"status",
			]);
			assert.equal(state.instance, home);
			assert.equal(state.settings.channel, "nightly");
			assert.equal(state.effectivePolicy, "idle-auto");
			assert.equal(workerOwner(home), undefined);
			return {
				settings: state.settings,
				installed: state.installed,
				noWorkerStarted: true,
			};
		},
	);
	await check(
		"actual signed shell installation grants bound ownership; changed receipt revokes it",
		async () => {
			const executable = join(prefix, "bin/bobs-factory");
			const proof = installationProof(home, executable);
			assert(proof);
			assert.equal(proof.kind, "installer");
			assertInstallationProof(home, executable, proof);
			const bytes = readFileSync(proof.record);
			const selectedBytes = readFileSync(executable);
			try {
				writeFileSync(
					proof.record,
					jsonBytes({ ...JSON.parse(bytes), channel: "stable" }),
				);
				assert.throws(
					() => assertInstallationProof(home, executable, proof),
					/ownership changed/,
				);
				assert.deepEqual(readFileSync(executable), selectedBytes);
			} finally {
				writeFileSync(proof.record, bytes);
			}
			assertInstallationProof(home, executable, proof);
			return {
				kind: proof.kind,
				recordSha256: proof.sha256,
				tamperRejected: true,
				executableUnchanged: true,
			};
		},
	);
	await check(
		"both overrides, pause and pin survive explicit reinstall and ordinary default reinstall",
		async () => {
			const exe = join(prefix, "bin/bobs-factory");
			await cli(exe, [
				"update",
				"settings",
				"--channel",
				"stable",
				"--policy",
				"idle-auto",
			]);
			await cli(exe, [
				"update",
				"settings",
				"--channel",
				"nightly",
				"--policy",
				"manual",
				"--pause",
				"--pin",
				n1.manifest.version,
			]);
			const expected = (await cli(exe, ["update", "status"])).settings;
			let r = await install(n1, [
				"--channel",
				"nightly",
				"--version",
				n1.manifest.version,
			]);
			assert.equal(r.code, 0, r.stderr);
			assert.deepEqual(
				(await cli(exe, ["update", "status"])).settings,
				expected,
			);
			r = await install(stable);
			assert.equal(r.code, 0, r.stderr);
			assert.deepEqual(
				(await cli(exe, ["update", "status"])).settings,
				expected,
			);
			// Deliberate stable handoff changes channel only, retaining both choices and controls.
			r = await install(stable, ["--channel", "stable"]);
			assert.equal(r.code, 0, r.stderr);
			assert.deepEqual((await cli(exe, ["update", "status"])).settings, {
				...expected,
				channel: "stable",
			});
			return { retainedSettings: expected };
		},
	);
	await check(
		"signed source offline failure is visible and recoverable",
		async () => {
			f.show([n1]);
			const manager = new UpdateManager(
				join(work, "offline-home"),
				newSource(join(work, "offline-stage")),
				undefined,
				previous,
			);
			manager.configure({ channel: "nightly" }, manager.status().revision);
			f.offline(true);
			await manager.check();
			assert(manager.status().error);
			assert.equal(manager.status().failures, 1);
			assert.equal(manager.status().pending, undefined);
			f.offline(false);
			await manager.check();
			assert.equal(manager.status().error, undefined);
			assert.equal(
				manager.status().pending.candidate.version,
				n1.manifest.version,
			);
		},
	);

	// Actual owned worker, actual authenticated drain/preflight/snapshot/stop/link/
	// start/health and rollback. Only provider protocol and fault timing are controlled.
	const nativeHome = join(work, "owned-home");
	mkdirSync(nativeHome);
	liveHomes.add(nativeHome);
	const repo = join(work, "repo");
	mkdirSync(repo);
	execFileSync("git", ["init", "-q", "-b", "main", repo], { env });
	execFileSync(
		"git",
		[
			"-C",
			repo,
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@example.invalid",
			"commit",
			"--allow-empty",
			"-qm",
			"fixture",
		],
		{ env },
	);
	execFileSync(
		"git",
		[
			"-C",
			repo,
			"remote",
			"add",
			"origin",
			"https://github.com/example/signed-fixture.git",
		],
		{ env },
	);
	writeFileSync(
		join(nativeHome, "config.json"),
		jsonBytes({ repositories: [localRepository(repo, nativeHome, "fixture")] }),
	);
	const link = desktopExecutable(nativeHome, nativeDirectory(stable));
	const port = 19681;
	const workflow = validateWorkflows([
		...defaultWorkflows,
		{
			id: "signed-update-preservation",
			name: "Controlled native update preservation",
			entry: "question",
			steps: [
				{
					id: "question",
					name: "Ask once",
					type: "agent",
					prompt: "Mock only",
					askQuestions: true,
				},
			],
		},
	]).at(-1);
	let mockCalls = 0;
	const runtime = new WorkflowRuntime(nativeHome, {
		agent: async (ctx) => {
			mockCalls++;
			ctx.checkpointAgent?.({
				sessionId: "controlled-native-session-id",
				runner: "codex",
				cwd: repo,
			});
			return { questions: ["Choose a color"] };
		},
		script: async () => {
			throw Error("Unexpected script");
		},
		tool: async () => {
			throw Error("Unexpected tool");
		},
	});
	const run = runtime.create({
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
		title: "Preserve waiting question",
		repositoryId: "fixture",
		workspace: repo,
		input: "mock",
		workflow,
	});
	void runtime.launch(run);
	await until(
		() => runtime.get(run.id).status === "waiting",
		"waiting fixture did not persist",
	);
	assert.equal(mockCalls, 1);
	const sentinel = join(repo, "accepted-evidence.txt");
	writeFileSync(sentinel, "retained worktree evidence");
	const hostNative = join(process.env.HOME, ".codex");
	mkdirSync(hostNative);
	writeFileSync(
		join(hostNative, "test-only-session"),
		"TEST ONLY native boundary",
	);
	let hook,
		failedHealth = false,
		lostAck = false,
		lostAckOutcome = "succeeded",
		ackInjected = false,
		activations = 0,
		stops = 0;
	class Lifecycle extends OwnedUpdateLifecycle {
		async preflight(...args) {
			const result = await super.preflight(...args);
			if (hook) {
				const h = hook;
				hook = undefined;
				await h();
			}
			return result;
		}
		async stop() {
			const owner = workerOwner(nativeHome);
			assert(owner && ownerAlive(owner));
			stops++;
			await super.stop();
			assert.equal(workerOwner(nativeHome), undefined);
			assert.equal(ownerAlive(owner), false);
		}
		async activate(staged) {
			assert.equal(workerOwner(nativeHome), undefined);
			activations++;
			return super.activate(staged);
		}
		async health(identity) {
			if (failedHealth && identity.version === n3.manifest.version)
				throw Error("Controlled replacement health failure");
			return super.health(identity);
		}
		async releaseMaintenance(id) {
			await super.releaseMaintenance(id);
			if (
				lostAck &&
				!ackInjected &&
				JSON.parse(readFileSync(join(nativeHome, "updates/state.json")))
					.transaction?.release?.outcome === lostAckOutcome
			) {
				ackInjected = true;
				throw Error("Controlled lost exact release acknowledgment");
			}
		}
	}
	let lifecycle = new Lifecycle(nativeHome, port);
	const source = newSource(join(nativeHome, "updates"), realpathSync(link));
	let manager = new UpdateManager(nativeHome, source, lifecycle, previous);
	const cfg = (patch) => manager.configure(patch, manager.status().revision);
	async function wrongRuntimeRejected(executable, outcome) {
		const journal = readFileSync(join(nativeHome, "updates/state.json"));
		const transaction = JSON.parse(journal).transaction;
		assert.equal(transaction.phase, "recovery-required");
		assert.equal(transaction.release.outcome, outcome);
		assert.equal(transaction.release.status, "pending");
		// Cold startup observes a real lost-ack journal in another controlled home.
		// It cannot touch the selected owner or ask a provider to resume its work.
		const isolated = join(work, `wrong-runtime-${outcome}`);
		mkdirSync(join(isolated, "updates"), { recursive: true });
		writeFileSync(join(isolated, "updates/state.json"), journal);
		writeFileSync(
			join(isolated, "config.json"),
			jsonBytes({ repositories: [] }),
		);
		const r = await command(
			executable,
			["--home", isolated, "--port", "19689", "--no-open", "local"],
			{ env, timeout: 10000 },
		);
		assert.equal(
			r.code,
			1,
			"Wrong runtime must fail startup before readiness, not run until fixture timeout",
		);
		assert.equal(r.signal, null);
		assert.match(r.stderr, /Installed runtime.*match/i);
		assert.deepEqual(
			readFileSync(join(isolated, "updates/state.json")),
			journal,
		);
		const owner = workerOwner(isolated);
		assert(!owner || !ownerAlive(owner));
		const build = JSON.parse(
			readFileSync(join(dirname(executable), "build.json")),
		);
		return {
			outcome,
			rejectedVersion: build.version,
			executableSha256: build.executable.sha256,
			journalUnchanged: true,
			exitCode: r.code,
		};
	}
	async function selected(release, channel = "nightly") {
		manager = new UpdateManager(
			nativeHome,
			newSource(join(nativeHome, "updates"), realpathSync(link)),
			lifecycle,
			previous,
		);
		f.show([release, stable]);
		cfg({ channel, paused: false, pin: null });
		await manager.check();
		await manager.stage();
		assert.equal(
			manager.status().pending.candidate.version,
			release.manifest.version,
		);
	}
	async function reconcile() {
		let r;
		for (let n = 0; n < 30; n++) {
			r = await manager.reconcile();
			if (
				r.transaction?.phase !== "cancelled" ||
				!r.transaction.error?.startsWith("Waiting for active work")
			)
				return r;
			await wait(200);
		}
		return r;
	}
	await lifecycle.start();
	await until(async () => {
		try {
			return (await fetch(`http://localhost:${port}/api/auth/status`)).ok;
		} catch {
			return false;
		}
	}, "worker dashboard missing");
	await wait(600);
	const persisted = JSON.parse(
		readFileSync(join(nativeHome, "factory/runs", `${run.id}.json`)),
	);
	const authMarker = join(nativeHome, "factory/auth/test-only-preservation");
	writeFileSync(authMarker, "TEST ONLY credential boundary");
	const api = new FactoryClient({
		home: nativeHome,
		port,
		requestSession: requestFactoryTerminalSession,
	});
	await check(
		"CLI and authenticated native API retain both channel overrides, pause and pin",
		async () => {
			for (const args of [
				["--channel", "stable", "--policy", "idle-auto"],
				[
					"--channel",
					"nightly",
					"--policy",
					"manual",
					"--pause",
					"--pin",
					n1.manifest.version,
				],
			]) {
				const r = await command(
					link,
					["--home", nativeHome, "update", "settings", ...args],
					{ env },
				);
				assert.equal(r.code, 0, r.stderr);
			}
			const saved = manager.status();
			assert.deepEqual(saved.settings, {
				channel: "nightly",
				overrides: { stable: "idle-auto", nightly: "manual" },
				paused: true,
				pin: n1.manifest.version,
			});
			assert.deepEqual(
				(await api.get("/api/updates")).settings,
				saved.settings,
			);
			const changed = await api.put("/api/updates/settings", {
				revision: saved.revision,
				settings: { channel: "stable", paused: false, pin: null },
			});
			const r = await command(
				link,
				["--home", nativeHome, "update", "status"],
				{ env },
			);
			assert.equal(r.code, 0, r.stderr);
			assert.deepEqual(JSON.parse(r.stdout).settings, changed.settings);
			assert.deepEqual(changed.settings.overrides, saved.settings.overrides);
			await assert.rejects(
				api.put("/api/updates/settings", {
					revision: saved.revision,
					settings: { paused: true },
				}),
				/changed|revision|stale/i,
			);
			assert.deepEqual(
				new UpdateManager(nativeHome).status().settings,
				changed.settings,
			);
			// Restore documented defaults through the production API before subscription.
			for (const channel of ["nightly", "stable"]) {
				await api.put("/api/updates/settings", {
					revision: manager.status().revision,
					settings: { channel, policy: "default" },
				});
			}
			return {
				cliSaved: saved.settings,
				apiSaved: changed.settings,
				staleWriteRejected: true,
			};
		},
	);
	const preserved = () => {
		const next = JSON.parse(
			readFileSync(join(nativeHome, "factory/runs", `${run.id}.json`)),
		);
		for (const key of [
			"status",
			"workflow",
			"workflowDefinitions",
			"checkpoint",
			"outputs",
			"questions",
			"questionBatchId",
			"answers",
			"reviewGate",
		])
			assert.deepEqual(next[key], persisted[key], `preserve ${key}`);
		assert.equal(
			readFileSync(authMarker, "utf8"),
			"TEST ONLY credential boundary",
		);
		assert.equal(readFileSync(sentinel, "utf8"), "retained worktree evidence");
		assert.equal(
			readFileSync(join(hostNative, "test-only-session"), "utf8"),
			"TEST ONLY native boundary",
		);
	};
	await check(
		"explicit subscription to a later signed nightly replaces one real idle owned worker",
		async () => {
			const r = await command(
				link,
				["--home", nativeHome, "update", "settings", "--channel", "nightly"],
				{ env },
			);
			assert.equal(r.code, 0, r.stderr);
			assert.equal(manager.status().effectivePolicy, "idle-auto");
			f.show([n1, stable]);
			await manager.check();
			await manager.stage();
			const old = workerOwner(nativeHome);
			manager.requestInstall(
				candidateKey(manager.status().pending.candidate),
				manager.status().revision,
			);
			let result = await reconcile();
			assert.equal(
				result.transaction.phase,
				"succeeded",
				JSON.stringify(result.transaction),
			);
			assert.equal(result.installed.version, n1.manifest.version);
			await selected(n2);
			assert.equal(manager.status().pending.consentRevision, undefined);
			const capacity = new MachineCapacity(
				undefined,
				join(nativeHome, "machine-capacity"),
			);
			await capacity.ready();
			const lease = await capacity.acquireLease(undefined, {
				identity: "signed-update-controlled-descendant",
			});
			const child = spawn(process.execPath, ["-e", "setTimeout(()=>{},1500)"], {
				env: { ...env, BOBS_FACTORY_EXECUTION_LEASE: lease.token },
				stdio: "ignore",
			});
			const exited = once(child, "exit");
			const stopsBeforeBusy = stops;
			try {
				result = await manager.reconcile();
				assert.equal(result.transaction.phase, "cancelled");
				assert.match(result.transaction.error, /Waiting for active work/);
				assert.equal(stops, stopsBeforeBusy);
				assert.equal(child.exitCode, null);
				const [code, signal] = await exited;
				assert.equal(code, 0);
				assert.equal(signal, null);
			} finally {
				await lease.release();
				await capacity.shutdown();
			}
			result = await reconcile();
			assert.equal(
				result.transaction.phase,
				"succeeded",
				JSON.stringify(result.transaction),
			);
			assert.equal(result.installed.version, n2.manifest.version);
			assert.notEqual(workerOwner(nativeHome).pid, old.pid);
			preserved();
			assert.equal(
				(await api.get("/api/version")).runtime.version,
				n2.manifest.version,
			);
			return {
				transaction: result.transaction,
				owner: workerOwner(nativeHome),
				preservedRunId: run.id,
				mockedAgentCalls: mockCalls,
			};
		},
	);
	await check(
		"real paused/pinned/manual policy races after native preflight cancel before stop",
		async () => {
			for (const patch of [
				{ paused: true },
				{ pin: n1.manifest.version },
				{ policy: "manual" },
				{ channel: "stable" },
			]) {
				cfg({
					channel: "nightly",
					policy: "default",
					paused: false,
					pin: null,
				});
				await selected(n3);
				const old = workerOwner(nativeHome);
				const before = stops;
				hook = () => cfg(patch);
				const r = await reconcile();
				assert.equal(
					r.transaction.phase,
					"cancelled",
					JSON.stringify(r.transaction),
				);
				assert.equal(stops, before);
				assert.equal(workerOwner(nativeHome).pid, old.pid);
				preserved();
			}
		},
	);
	await check(
		"manual nightly holds a signed candidate until exact explicit Install, with lost-ack recovery",
		async () => {
			await selected(n3);
			cfg({ policy: "manual" });
			const old = workerOwner(nativeHome);
			const before = stops;
			await manager.reconcile();
			assert.equal(stops, before);
			assert.equal(workerOwner(nativeHome).pid, old.pid);
			lostAck = true;
			manager.requestInstall(
				candidateKey(manager.status().pending.candidate),
				manager.status().revision,
			);
			let r = await reconcile();
			assert.equal(r.transaction.phase, "recovery-required");
			assert.equal(r.transaction.release.status, "pending");
			assert.equal(r.transaction.release.outcome, "succeeded");
			const rejected = await wrongRuntimeRejected(
				r.transaction.staged.previousExecutable,
				"succeeded",
			);
			const newOwner = workerOwner(nativeHome),
				count = activations;
			lifecycle = new OwnedUpdateLifecycle(nativeHome, port);
			manager = new UpdateManager(nativeHome, source, lifecycle, previous);
			r = await manager.recover("operation owner stopped");
			assert.equal(r.transaction.phase, "succeeded");
			assert.equal(r.transaction.release.status, "acknowledged");
			assert.equal(activations, count);
			assert.equal(workerOwner(nativeHome).pid, newOwner.pid);
			preserved();
			lostAck = false;
			return { wrongRuntime: rejected, recoveredPhase: r.transaction.phase };
		},
	);
	await check(
		"stable return requires explicit downgrade consent and actual compatibility preflight",
		async () => {
			// A new source binds the CURRENT previous executable for every replacement.
			lifecycle = new Lifecycle(nativeHome, port);
			manager = new UpdateManager(
				nativeHome,
				newSource(join(nativeHome, "return-stage"), realpathSync(link)),
				lifecycle,
				previous,
			);
			cfg({ channel: "stable", policy: "idle-auto" });
			f.show([stable, n2]);
			await manager.check();
			await manager.stage();
			const before = stops,
				old = workerOwner(nativeHome);
			await manager.reconcile();
			assert.equal(stops, before);
			assert.equal(workerOwner(nativeHome).pid, old.pid);
			manager.requestInstall(
				candidateKey(manager.status().pending.candidate),
				manager.status().revision,
			);
			const r = await reconcile();
			assert.equal(
				r.transaction.phase,
				"succeeded",
				JSON.stringify(r.transaction),
			);
			assert.equal(r.installed.version, stable.manifest.version);
			preserved();
		},
	);
	await check(
		"stable manual holds newer signed release; saved idle-auto override activates without consent",
		async () => {
			lifecycle = new Lifecycle(nativeHome, port);
			manager = new UpdateManager(
				nativeHome,
				newSource(join(nativeHome, "stable-upgrade-stage"), realpathSync(link)),
				lifecycle,
				previous,
			);
			cfg({ channel: "stable", policy: "default" });
			await selected(stable2, "stable");
			assert.equal(manager.status().effectivePolicy, "manual");
			const old = workerOwner(nativeHome),
				before = stops;
			await manager.reconcile();
			assert.equal(stops, before);
			assert.equal(workerOwner(nativeHome).pid, old.pid);
			cfg({ policy: "idle-auto" });
			assert.equal(manager.status().pending.consentRevision, undefined);
			const result = await reconcile();
			assert.equal(
				result.transaction.phase,
				"succeeded",
				JSON.stringify(result.transaction),
			);
			assert.equal(result.installed.version, stable2.manifest.version);
			preserved();
			cfg({ channel: "nightly", policy: "manual" });
			cfg({ channel: "stable" });
			assert.equal(manager.status().effectivePolicy, "idle-auto");
			assert.deepEqual(manager.status().settings.overrides, {
				stable: "idle-auto",
				nightly: "manual",
			});
			assert.deepEqual(
				new UpdateManager(nativeHome).status().settings,
				manager.status().settings,
			);
		},
	);
	await check(
		"failed real signed replacement rolls back compatible owned state and suppresses repeat activation",
		async () => {
			lifecycle = new Lifecycle(nativeHome, port);
			manager = new UpdateManager(
				nativeHome,
				newSource(join(nativeHome, "rollback-stage"), realpathSync(link)),
				lifecycle,
				previous,
			);
			await selected(n3);
			cfg({ policy: "idle-auto" });
			failedHealth = true;
			lostAck = true;
			lostAckOutcome = "rolled-back";
			ackInjected = false;
			manager.requestInstall(
				candidateKey(manager.status().pending.candidate),
				manager.status().revision,
			);
			let r = await reconcile();
			assert.equal(
				r.transaction.phase,
				"recovery-required",
				JSON.stringify(r.transaction),
			);
			const rejected = await wrongRuntimeRejected(
				r.transaction.staged.executable,
				"rolled-back",
			);
			const rolledBackOwner = workerOwner(nativeHome),
				count = activations;
			manager = new UpdateManager(
				nativeHome,
				source,
				new OwnedUpdateLifecycle(nativeHome, port),
				previous,
			);
			r = await manager.recover("rollback release acknowledgment lost");
			assert.equal(workerOwner(nativeHome).pid, rolledBackOwner.pid);
			assert.equal(activations, count);
			assert.equal(
				r.transaction.phase,
				"rolled-back",
				JSON.stringify(r.transaction),
			);
			assert.equal(r.installed.version, stable2.manifest.version);
			preserved();
			const before = activations;
			await manager.reconcile();
			assert.equal(activations, before);
			assert(
				manager
					.status()
					.badCandidates.includes(candidateKey(r.transaction.candidate)),
			);
			failedHealth = false;
			lostAck = false;
			return { wrongRuntime: rejected, recoveredPhase: r.transaction.phase };
		},
	);
	await check(
		"unrelated npm trial uses its own home and cannot take over an existing owned worker",
		async () => {
			const before = workerOwner(nativeHome),
				saved = readFileSync(join(nativeHome, "updates/state.json"));
			f.pointer(stable);
			const r = await command(
				process.execPath,
				[
					"--import",
					f.preload,
					join(
						root,
						"distribution/npm/bobs-factory-trial/bin/bobs-factory-trial.mjs",
					),
					"--channel",
					"stable",
					"--no-open",
					"--port",
					"19685",
					"--",
					"--version",
				],
				{ env: { ...env, ...f.env }, timeout: 120000 },
			);
			assert.equal(r.code, 0, r.stderr);
			assert.match(r.stdout, /1\.0\.0/);
			assert.match(r.stdout, /Removed the temporary runtime/);
			assert.equal(workerOwner(nativeHome).pid, before.pid);
			assert.deepEqual(
				readFileSync(join(nativeHome, "updates/state.json")),
				saved,
			);
			preserved();
			assert.equal(
				existsSync(
					join(process.env.HOME, ".bobs-factory-trial/.launcher-lock"),
				),
				false,
			);
			// Start the actual verified native trial beside the independently owned
			// worker. Terminate only the just-spawned launcher; it owns its child.
			const trialHome = join(process.env.HOME, ".bobs-factory-trial");
			const trialArgs = [
				"--import",
				f.preload,
				join(
					root,
					"distribution/npm/bobs-factory-trial/bin/bobs-factory-trial.mjs",
				),
				"--channel",
				"stable",
				"--no-open",
				"--port",
				"19685",
			];
			const trial = spawn(process.execPath, trialArgs, {
				env: { ...env, ...f.env },
				stdio: ["ignore", "pipe", "pipe"],
			});
			let trialOutput = "",
				trialError = "";
			trial.stdout.on("data", (b) => (trialOutput += b));
			trial.stderr.on("data", (b) => (trialError += b));
			const trialClosed = once(trial, "close");
			try {
				for (let n = 0; n < 400; n++) {
					if (trial.exitCode !== null)
						throw Error(`Trial exited before startup: ${trialError}`);
					try {
						if ((await fetch("http://localhost:19685/api/auth/status")).ok)
							break;
					} catch {}
					await wait(100);
				}
				const trialOwner = workerOwner(trialHome);
				assert(trialOwner && ownerAlive(trialOwner));
				assert.notEqual(trialOwner.pid, before.pid);
				assert.equal(trialOwner.home, realpathSync(trialHome));
				assert.equal(workerOwner(nativeHome).pid, before.pid);
				const duplicate = await command(process.execPath, trialArgs, {
					env: { ...env, ...f.env },
				});
				assert.notEqual(duplicate.code, 0);
				assert.match(duplicate.stderr, /Another trial/);
				assert.equal(workerOwner(trialHome).pid, trialOwner.pid);
			} finally {
				trial.kill("SIGTERM");
				await trialClosed;
			}
			assert.match(trialOutput, /Removed the temporary runtime/);
			assert.equal(workerOwner(trialHome), undefined);
			assert.equal(existsSync(join(trialHome, ".launcher-lock")), false);
			assert.deepEqual(
				readFileSync(join(nativeHome, "updates/state.json")),
				saved,
			);
			assert.equal(workerOwner(nativeHome).pid, before.pid);
			preserved();
		},
	);
	await check(
		"missing explicit installation owner refuses replacement and preserves external bytes",
		async () => {
			const external = join(work, "external-install");
			mkdirSync(external);
			const bytes = Buffer.from("externally managed executable sentinel");
			const executable = join(external, "bobs-factory");
			writeFileSync(executable, bytes);
			assert.throws(
				() => new OwnedUpdateLifecycle(external, 19687),
				/external owner/,
			);
			assert.deepEqual(readFileSync(executable), bytes);
			assert.equal(workerOwner(external), undefined);
			// Real Homebrew/DEB/AUR/Nix/AppImage install trials are separate native gates.
		},
	);
	assert(
		f.requests.every((r) => !r.authorization),
		"No fixture release request may carry provider credentials",
	);
	completed = true;
} finally {
	for (const h of liveHomes) {
		const owner = workerOwner(h);
		if (owner && ownerAlive(owner)) {
			process.kill(owner.pid, "SIGTERM");
			await until(
				() => !workerOwner(h),
				"isolated worker did not release ownership",
			);
		}
	}
	await f.close();
	const receipt = {
		schemaVersion: 1,
		purpose:
			"TEST ONLY signed source/install/runtime integration; NOT release publication evidence",
		passed: completed && results.every((r) => r.passed),
		harnessSha256,
		sourceCommit: buildsReceipt[0].commit,
		target,
		fixtureKeyFingerprint: f.keyFingerprint,
		builds: buildsReceipt,
		results,
		requests: f.requests,
		limitations: [
			"Other native targets are inventory fixtures with explicit not-run status.",
			"Ephemeral TEST signing pin is not production publisher trust.",
			"Mock checkpoint ID is preserved; no real agent continuation/credits.",
			"Host native credential boundary uses sentinel bytes only; production stores are never read.",
			"No OS service, actual Electron shell, package manager, login/reboot or publication exercised.",
		],
	};
	writeFileSync(join(output, "signed-delivery.json"), jsonBytes(receipt));
	console.log(`Receipt ${join(output, "signed-delivery.json")}`);
}
