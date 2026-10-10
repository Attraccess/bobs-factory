// node ... RUNTIME_DIRECTORY MOUNTED_APP ELECTRON_TEST_EXECUTABLE
// Isolated macOS ARM proof; no publication, live auth, provider credits or host services.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { request } from "node:http";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { repository, seed, until } from "./acceptance-fixture.mjs";

assert.equal(
	process.platform,
	"darwin",
	"This maintained proof currently targets macOS; existing all4 matrix is separate",
);
const [runtimePath, appPath, electronPath] = process.argv
	.slice(2)
	.map((path) => resolve(path));
assert(runtimePath && appPath && electronPath);
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const build = JSON.parse(readFileSync(join(runtimePath, "build.json"), "utf8"));
const binary = join(runtimePath, "bobs-factory");
assert.equal(hash(readFileSync(binary)), build.executable.sha256);
assert.equal(build.dirty, false);
assert.equal(build.commit, "ed7bcaf6feb0fb8f39d9e0255b2fea0bfffeb1f1");
const productionPaths = [
	"apps/desktop/src",
	"apps/cli/src",
	"packages/edge-worker/src",
];
execFileSync(
	"git",
	["diff", "--quiet", build.commit, "HEAD", "--", ...productionPaths],
	{ cwd: sourceRoot },
);
execFileSync("git", ["diff", "--quiet", "HEAD", "--", ...productionPaths], {
	cwd: sourceRoot,
});
const root = realpathSync(
	mkdtempSync(join(tmpdir(), "factory-native-acceptance-")),
);
// Temporary repositories must not inherit operator Git hooks or signing preferences.
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
const localHome = join(root, "local");
const remoteHome = join(root, "remote");
const temporaryHome = join(root, "account");
const stubs = join(root, "commands");
for (const path of [remoteHome, temporaryHome, stubs])
	mkdirSync(path, { recursive: true, mode: 0o700 });
const localState = await seed(localHome);
repository(remoteHome);
for (const cmd of ["codex", "claude", "gemini", "agent", "opencode", "gh"])
	writeFileSync(
		join(stubs, cmd),
		`#!/bin/sh\nif test "$1" = --version; then printf '${cmd} fixture-only\\n'; exit 0; fi\nprintf '${cmd}\\n' >> '${join(root, "forbidden-agent-calls")}'\nexit 99\n`,
		{ mode: 0o755 },
	);
const env = {
	HOME: temporaryHome,
	PATH: `${stubs}:/usr/bin:/bin`,
	TMPDIR: root,
	F1_AGENT_MODE: "mock",
	BOBS_FACTORY_DESKTOP_BINARY: binary,
	LANG: "en_US.UTF-8",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
};
// Ephemeral TLS transport material only, never a release-signing/native-store key.
execFileSync(
	"openssl",
	[
		"req",
		"-x509",
		"-newkey",
		"rsa:2048",
		"-nodes",
		"-keyout",
		join(root, "tls.key"),
		"-out",
		join(root, "tls.crt"),
		"-days",
		"1",
		"-subj",
		"/CN=localhost",
		"-addext",
		"subjectAltName=DNS:localhost",
	],
	{ stdio: "ignore" },
);
const tlsFingerprint = execFileSync(
	"openssl",
	["x509", "-in", join(root, "tls.crt"), "-noout", "-fingerprint", "-sha256"],
	{ encoding: "utf8" },
)
	.trim()
	.split("=")[1];
const localPort = 19771,
	remotePort = 19872,
	tlsPort = 19873;
const remoteOrigin = `https://localhost:${tlsPort}`;
const children = [];
const spawnLogged = (exe, args, name, more = {}) => {
	const child = spawn(exe, args, {
		env: { ...env, ...more },
		stdio: ["ignore", "pipe", "pipe"],
	});
	children.push(child);
	let logs = "";
	for (const stream of [child.stdout, child.stderr])
		stream.on("data", (data) => {
			logs += data;
			writeFileSync(join(root, `${name}.log`), logs);
		});
	return child;
};
const exited = (child) =>
	new Promise((resolveExit, reject) => {
		if (child.exitCode !== null) return resolveExit(child.exitCode);
		child.once("error", reject);
		child.once("exit", resolveExit);
	});
let backend, proxy;
try {
	backend = spawnLogged(
		process.execPath,
		[
			join(sourceRoot, "apps/desktop/test/acceptance-fixture.mjs"),
			remoteHome,
			String(remotePort),
			remoteOrigin,
		],
		"backend",
	);
	await until(
		() => existsSync(join(remoteHome, "backend-ready.json")),
		"protected second backend",
	);
	for (const [method, origin, status] of [
		["GET", remoteOrigin, 401],
		["PUT", remoteOrigin, 401],
		["PUT", `http://localhost:${localPort}`, 403],
	]) {
		const result = await new Promise((resolveStatus, reject) => {
			const req = request(
				{
					hostname: "127.0.0.1",
					port: remotePort,
					path: `/api/updates${method === "PUT" ? "/settings" : ""}`,
					method,
					headers: {
						Host: new URL(remoteOrigin).host,
						Origin: origin,
						"X-Factory-Request": "1",
						"Content-Type": "application/json",
					},
				},
				(response) => {
					response.resume();
					resolveStatus(response.statusCode);
				},
			);
			req.on("error", reject);
			req.end(
				method === "PUT"
					? JSON.stringify({ revision: 0, settings: { paused: true } })
					: undefined,
			);
		});
		assert.equal(result, status, "Second backend auth/origin boundary");
	}
	proxy = createServer(
		{
			key: readFileSync(join(root, "tls.key")),
			cert: readFileSync(join(root, "tls.crt")),
		},
		(incoming, outgoing) => {
			if (
				incoming.url.startsWith("/api/") &&
				existsSync(join(root, "disconnect-proxy"))
			) {
				outgoing.writeHead(503, { "content-type": "application/json" });
				outgoing.end(JSON.stringify({ error: "Controlled connection loss" }));
				return;
			}
			const forwarded = request(
				{
					hostname: "127.0.0.1",
					port: remotePort,
					path: incoming.url,
					method: incoming.method,
					headers: incoming.headers,
				},
				(response) => {
					outgoing.writeHead(response.statusCode, response.headers);
					response.pipe(outgoing);
				},
			);
			forwarded.on("error", () => {
				outgoing.writeHead(502);
				outgoing.end();
			});
			incoming.pipe(forwarded);
		},
	);
	await new Promise((ready) => proxy.listen(tlsPort, "127.0.0.1", ready));
	const settings = {
		root,
		localHome,
		remoteHome,
		localPort,
		remoteOrigin,
		remotePid: backend.pid,
		runtimeCommit: build.commit,
		runtime: build,
		localState,
		tlsFingerprint,
		mainPath: join(appPath, "Contents/Resources/app.asar/src/main.mjs"),
	};
	const config = join(root, "fixture-config.json");
	const electron = electronPath;
	let independent;
	const independentHome = join(root, "independent");
	for (const phase of ["first", "reopen", "restart", "independent"]) {
		let selected = settings;
		if (phase === "independent") {
			mkdirSync(independentHome, { mode: 0o700 });
			independent = spawnLogged(
				binary,
				["--home", independentHome, "--port", "19971", "--no-open", "local"],
				"independent-worker",
			);
			await until(async () => {
				try {
					return (await fetch("http://localhost:19971/api/auth/status")).ok;
				} catch {
					return false;
				}
			}, "foreground worker ready");
			selected = {
				...settings,
				localHome: independentHome,
				localPort: 19971,
				independentPid: independent.pid,
			};
		}
		writeFileSync(config, JSON.stringify({ ...selected, phase }));
		const child = spawnLogged(
			electron,
			[
				`--user-data-dir=${join(root, "electron-profile")}`,
				join(sourceRoot, "apps/desktop/test/native-acceptance.mjs"),
			],
			`electron-${phase}`,
			{ F1_NATIVE_ACCEPTANCE_CONFIG: config },
		);
		const timeout = setTimeout(() => child.kill("SIGTERM"), 90000);
		const code = await exited(child);
		clearTimeout(timeout);
		assert.equal(
			code,
			0,
			`Electron ${phase} failed. Inspect ${root}/electron-${phase}.log`,
		);
		assert(
			JSON.parse(readFileSync(join(root, `phase-${phase}.json`), "utf8"))
				.passed,
		);
		if (phase === "first") {
			const receipt = JSON.parse(
				readFileSync(join(root, "phase-first.json"), "utf8"),
			);
			for (const [file, digest] of Object.entries(receipt.mountedShellFiles))
				assert.equal(
					digest,
					hash(
						execFileSync(
							"git",
							["show", `${build.commit}:apps/desktop/src/${file}`],
							{ cwd: sourceRoot },
						),
					),
					`Mounted immutable ${file}`,
				);
			process.kill(receipt.workerPid, 0);
			process.kill(receipt.jobPid, 0);
			process.kill(receipt.descendantPid, 0);
		}
		if (phase === "independent") {
			process.kill(independent.pid, 0);
			independent.kill("SIGTERM");
			await exited(independent);
		}
	}
	assert(
		!existsSync(join(root, "forbidden-agent-calls")),
		"No live coding/provider/title process may execute",
	);
	const sourceFiles = [
		"apps/cli/src/onboarding.ts",
		"packages/edge-worker/src/factory/FactoryServer.ts",
		"packages/edge-worker/src/factory/WorkflowRuntime.ts",
		"packages/edge-worker/dist/factory/FactoryServer.js",
		"packages/edge-worker/dist/factory/WorkflowRuntime.js",
		"apps/cli/dist/src/onboarding.js",
		"apps/desktop/test/acceptance-fixture.mjs",
		"apps/desktop/test/native-acceptance.mjs",
		"apps/desktop/test/run-native-acceptance.mjs",
	];
	const receipts = {
		passed: true,
		sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: sourceRoot,
			encoding: "utf8",
		}).trim(),
		runtime: build,
		target: `${process.platform}-${process.arch}`,
		os: execFileSync("sw_vers", ["-productVersion"], {
			encoding: "utf8",
		}).trim(),
		fixture: root,
		files: Object.fromEntries(
			sourceFiles.map((file) => [
				file,
				hash(readFileSync(join(sourceRoot, file))),
			]),
		),
		first: JSON.parse(readFileSync(join(root, "phase-first.json"), "utf8")),
		reopen: JSON.parse(readFileSync(join(root, "phase-reopen.json"), "utf8")),
		restart: JSON.parse(readFileSync(join(root, "phase-restart.json"), "utf8")),
		independent: JSON.parse(
			readFileSync(join(root, "phase-independent.json"), "utf8"),
		),
		limits: [
			"Virtual CTAP2, no physical passkey",
			"One Mac, isolated second backend through local HTTPS proxy; not a second physical machine",
			"Onboarding production modules / synthetic GitHub / fake prepared coding CLI, no authenticated provider continuation",
			"No release trust/signing/publication, OS reboot/logout/minimum-platform or whole-shell replacement proof",
		],
	};
	writeFileSync(
		join(root, "native-acceptance.json"),
		JSON.stringify(receipts, null, 2),
	);
	console.log(JSON.stringify(receipts, null, 2));
} finally {
	for (const home of [localHome, remoteHome]) {
		for (const name of ["worker.lock", "update-supervisor.lock"])
			try {
				const owned = JSON.parse(readlinkSync(join(home, "runtime", name)));
				assert.equal(owned.home, realpathSync(home));
				process.kill(owned.pid, "SIGTERM");
			} catch (error) {
				if (!["ENOENT", "ESRCH"].includes(error.code)) console.error(error);
			}
	}
	if (backend?.exitCode === null) backend.kill("SIGTERM");
	for (const child of children)
		if (child.exitCode === null && child !== backend) child.kill("SIGTERM");
	proxy?.closeAllConnections();
	proxy?.close();
	if (backend) await exited(backend);
	console.error(`Retained isolated evidence: ${root}`);
}
