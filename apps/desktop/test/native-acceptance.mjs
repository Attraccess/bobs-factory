// Run with the exact native Electron binary; parent fixture owns temporary resources.
import assert from "node:assert/strict";
import { createHash, X509Certificate } from "node:crypto";
import {
	existsSync,
	readFileSync,
	readlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, Menu } from "electron";
import { preserved, until } from "./acceptance-fixture.mjs";

const settings = JSON.parse(
	readFileSync(process.env.F1_NATIVE_ACCEPTANCE_CONFIG, "utf8"),
);
const {
	root,
	localHome,
	remoteHome,
	localPort,
	remoteOrigin,
	mainPath,
	phase,
} = settings;
process.env.BOBS_FACTORY_DESKTOP_HOME = localHome;
process.env.BOBS_FACTORY_DESKTOP_PORT = String(localPort);
app.setPath("userData", join(root, "electron-profile"));
const errors = [];
dialog.showErrorBox = (title, message) => errors.push({ title, message });
dialog.showMessageBox = async () => ({ response: 1 });
// Test-only TLS trust for this fixture's exact certificate. No auth bypass.
app.on(
	"certificate-error",
	(event, _wc, url, _error, certificate, callback) => {
		if (
			new URL(url).origin === remoteOrigin &&
			new X509Certificate(certificate.data).fingerprint256 ===
				settings.tlsFingerprint
		) {
			event.preventDefault();
			callback(true);
		} else callback(false);
	},
);
const run = (win, source) => win.webContents.executeJavaScript(source, true);
const fetchJson = (win, path, options = {}) =>
	run(
		win,
		`fetch(${JSON.stringify(path)},${JSON.stringify(options)}).then(async r=>({status:r.status,body:await r.json()}))`,
	);
const button = async (win, label) => {
	await until(
		() =>
			run(
				win,
				`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`,
			),
		`button ${label}`,
	);
	await run(
		win,
		`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
	);
};
const input = (win, selector, value) =>
	run(
		win,
		`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing fixture input'); const proto=e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
	);
const text = (win) => run(win, "document.body.innerText");
const owner = (home) =>
	JSON.parse(readlinkSync(join(home, "runtime", "worker.lock")));
const diskRun = (id) =>
	JSON.parse(
		readFileSync(join(localHome, "factory", "runs", `${id}.json`), "utf8"),
	);
const alive = (pid) => {
	process.kill(pid, 0);
};
const menu = (label) =>
	Menu.getApplicationMenu()
		.items[0].submenu.items.find((item) => item.label === label)
		.click();
let launcher, local, remote;
async function connect(origin) {
	menu("Connect…");
	await run(
		launcher,
		`window.factoryLauncher.connect(${JSON.stringify(origin)})`,
	);
	const dashboard = BrowserWindow.getAllWindows().find((w) => w !== launcher);
	await until(() => !dashboard.webContents.isLoading(), "dashboard load");
	return dashboard;
}
async function authenticator(win) {
	win.webContents.debugger.attach("1.3");
	await win.webContents.debugger.sendCommand("WebAuthn.enable");
	await win.webContents.debugger.sendCommand(
		"WebAuthn.addVirtualAuthenticator",
		{
			options: {
				protocol: "ctap2",
				transport: "usb",
				hasResidentKey: true,
				hasUserVerification: true,
				isUserVerified: true,
				automaticPresenceSimulation: true,
			},
		},
	);
}
async function auth(win, home, localGrant = false) {
	await authenticator(win);
	if (!localGrant)
		await input(
			win,
			"input[type=password]",
			JSON.parse(
				readFileSync(join(home, "factory", "auth", "enroll.json"), "utf8"),
			).token,
		);
	await button(win, "Create passkey");
	await until(
		async () => (await fetchJson(win, "/api/auth/status")).body.authenticated,
		"virtual enrollment",
	);
}
async function main() {
	await import(mainPath);
	await app.whenReady();
	await until(() => BrowserWindow.getAllWindows().length === 1, "launcher");
	launcher = BrowserWindow.getAllWindows()[0];
	await until(() => !launcher.webContents.isLoading(), "launcher load");
	local = await connect(null);
	const worker = owner(localHome);
	const identity = (await fetchJson(local, "/api/version")).body;
	assert.equal(identity.runtime.commit, settings.runtimeCommit);
	assert.equal(identity.runtime.target, `${process.platform}-${process.arch}`);
	assert.equal(process.versions.electron, "44.7.0");
	if (phase === "independent") {
		assert.equal(worker.owner, "foreground");
		await auth(local, localHome, true);
		const priorErrors = errors.length;
		menu("Stop local Factory…");
		await until(
			() => errors.length > priorErrors,
			"independently owned local Stop rejected",
		);
		assert.match(errors.at(-1).message, /independently owned/);
		assert.equal(owner(localHome).pid, settings.independentPid);
		local.close();
		menu("Open Factory");
		assert(local.isVisible());
		alive(settings.independentPid);
		alive(settings.remotePid);
		writeFileSync(
			join(root, "phase-independent.json"),
			JSON.stringify(
				{
					passed: true,
					workerPid: worker.pid,
					owner: worker.owner,
					localAttachSamePid: true,
					explicitDesktopStopRejected: true,
					uiCloseKeepsForegroundAlive: true,
					errors,
				},
				null,
				2,
			),
		);
		menu("Quit desktop UI");
		return;
	}
	assert.equal(worker.owner, "desktop");
	if (phase === "restart") {
		const prior = JSON.parse(
			readFileSync(join(root, "phase-reopen.json"), "utf8"),
		);
		assert.notEqual(worker.pid, prior.workerPid);
		await until(
			async () =>
				(await fetchJson(local, "/api/auth/status")).body.authenticated,
			"auth retained through actual worker Stop/restart",
		);
		await until(
			() => diskRun("acceptance-review").status === "waiting",
			"review restored after worker restart",
		);
		assert.deepEqual(
			preserved(diskRun("acceptance-review")),
			settings.localState.captured["acceptance-review"],
		);
		assert.equal(diskRun("acceptance-question").status, "completed");
		assert.equal(diskRun("acceptance-active").status, "completed");
		assert.equal(
			readFileSync(join(localHome, "job-receipts"), "utf8"),
			"complete\n",
		);
		assert.equal(
			readFileSync(join(localHome, "mock-preparation-receipt"), "utf8"),
			"prepared once\n",
		);
		let stopped = false;
		dialog.showMessageBox = async (options) => {
			if (options.message?.startsWith("Factory stopped.")) stopped = true;
			return { response: 1 };
		};
		menu("Stop local Factory…");
		await until(() => stopped, "restart fixture cleanup Stop");
		alive(settings.remotePid);
		writeFileSync(
			join(root, "phase-restart.json"),
			JSON.stringify(
				{
					passed: true,
					workerPid: worker.pid,
					reviewGatePreserved: true,
					completedWorkNotReplayed: true,
					syntheticNativeCheckpointRetained: true,
					independentBackendAlive: true,
				},
				null,
				2,
			),
		);
		app.exit(0);
		return;
	}
	if (phase === "reopen") {
		const first = JSON.parse(
			readFileSync(join(root, "phase-first.json"), "utf8"),
		);
		assert.equal(
			worker.pid,
			first.workerPid,
			"relaunch must reattach to identical worker",
		);
		assert.equal(worker.nonce, first.workerNonce);
		alive(first.jobPid);
		alive(first.descendantPid);
		await until(
			async () =>
				(await fetchJson(local, "/api/auth/status")).body.authenticated,
			"native session survives UI quit",
		);
		for (const [id, saved] of Object.entries(settings.localState.captured))
			assert.deepEqual(preserved(diskRun(id)), saved);
		writeFileSync(join(localHome, "release-job"), "fixture release\n");
		await until(
			() => diskRun("acceptance-active").status === "completed",
			"native shell finishes after relaunch",
		);
		assert.equal(
			readFileSync(join(localHome, "job-receipts"), "utf8"),
			"complete\n",
		);
		const question = diskRun("acceptance-question");
		writeFileSync(join(localHome, "answer-fixture"), "blue\n");
		const result = await fetchJson(
			local,
			"/api/runs/acceptance-question/answer",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Factory-Request": "1",
				},
				body: JSON.stringify({
					answer: "Blue",
					context: {
						questions: question.questions,
						questionBatchId: question.questionBatchId,
						step: question.step,
					},
				}),
			},
		);
		assert.equal(result.status, 200);
		await until(
			() => diskRun("acceptance-question").status === "completed",
			"accepted answer completion",
		);
		assert.deepEqual(
			diskRun("acceptance-question").answers.map((entry) => ({
				answer: entry.answer,
				questions: entry.questions,
			})),
			[{ answer: "Blue", questions: ["Which fixture color?"] }],
		);
		assert.equal(
			readFileSync(join(localHome, "mock-preparation-receipt"), "utf8"),
			"prepared once\n",
		);
		assert.deepEqual(
			preserved(diskRun("acceptance-review")),
			settings.localState.captured["acceptance-review"],
		);
		assert.equal(
			readFileSync(join(settings.localState.worktree, "retained.txt"), "utf8"),
			"Accepted worktree output\n",
		);
		remote = await connect(remoteOrigin);
		assert.equal(
			(await fetchJson(remote, "/api/auth/status")).body.authenticated,
			true,
			"remote native session persists across actual UI process quit",
		);
		const savedSetup = (await fetchJson(remote, "/api/config")).body.onboarding;
		assert.equal(savedSetup.required, false);
		assert.equal(savedSetup.runner, "codex");
		assert.equal(savedSetup.github.account, "fixture-operator");
		local = await connect(null);
		assert.equal(owner(localHome).pid, worker.pid);
		let stopped = false;
		dialog.showMessageBox = async (options) => {
			if (options.message?.startsWith("Factory stopped.")) stopped = true;
			return { response: 1 };
		};
		menu("Stop local Factory…");
		await until(() => stopped, "native explicit Stop completion");
		assert(!existsSync(join(localHome, "runtime", "worker.lock")));
		assert(existsSync(join(localHome, "runtime", "desktop-stopped.json")));
		alive(settings.remotePid);
		writeFileSync(
			join(root, "phase-reopen.json"),
			JSON.stringify(
				{
					passed: true,
					workerPid: worker.pid,
					sameNonce: true,
					jobCompletedOnce: true,
					answerCompleted: true,
					reviewStillWaiting: true,
					explicitStopLeftIndependentBackendAlive: true,
					errors,
				},
				null,
				2,
			),
		);
		app.exit(0);
		return;
	}
	await auth(local, localHome, true);
	assert.equal(await run(local, "typeof window.factoryLauncher"), "undefined");
	await until(
		() => existsSync(join(localHome, "descendant.pid")),
		"native active descendant",
	);
	const jobPid = Number(readFileSync(join(localHome, "job.pid"), "utf8"));
	const descendantPid = Number(
		readFileSync(join(localHome, "descendant.pid"), "utf8"),
	);
	alive(jobPid);
	alive(descendantPid);
	for (const [id, saved] of Object.entries(settings.localState.captured))
		assert.deepEqual(preserved(diskRun(id)), saved);
	const localCookies = await local.webContents.session.cookies.get({
		url: `http://localhost:${localPort}`,
	});
	const localSession = local.webContents.session;
	const localCookie = localCookies.find(
		(cookie) => cookie.name === "factory-local-session",
	);
	assert(localCookie?.httpOnly);
	local.close();
	assert(!local.isVisible());
	menu("Open Factory");
	assert(local.isVisible());
	assert.equal(owner(localHome).pid, worker.pid);
	alive(jobPid);
	alive(descendantPid);
	remote = await connect(remoteOrigin);
	const remoteVersion = (await fetchJson(remote, "/api/version")).body;
	assert.equal(remoteVersion.build, identity.build);
	assert.equal(remoteVersion.protocol, identity.protocol);
	assert.equal(
		(await fetchJson(remote, "/api/auth/status")).body.authenticated,
		false,
	);
	assert.notEqual(remote.webContents.session, localSession);
	assert.equal(
		await run(remote, "typeof require + ':' + typeof window.factoryLauncher"),
		"undefined:undefined",
	);
	await auth(remote, remoteHome);
	const remoteCookies = await remote.webContents.session.cookies.get({
		url: remoteOrigin,
	});
	const remoteCookie = remoteCookies.find(
		(cookie) => cookie.name === "__Host-factory-session",
	);
	assert(remoteCookie?.httpOnly && remoteCookie.secure);
	await remote.webContents.session.cookies.set({
		url: remoteOrigin,
		name: remoteCookie.name,
		value: localCookie.value,
		path: "/",
		secure: true,
		httpOnly: true,
	});
	assert.equal(
		(await fetchJson(remote, "/api/config")).status,
		401,
		"local session cannot authorize remote host",
	);
	await remote.webContents.session.cookies.set({
		url: remoteOrigin,
		name: remoteCookie.name,
		value: remoteCookie.value,
		path: "/",
		secure: true,
		httpOnly: true,
	});
	assert.equal((await fetchJson(remote, "/api/config")).status, 200);
	// Actual mounted launcher rejects forbidden origins; native dashboard rejects navigation.
	const rejected = await run(
		launcher,
		"window.factoryLauncher.connect('http://example.invalid').then(()=>false,e=>e.message)",
	);
	assert.match(rejected, /HTTPS/);
	let navigated = false;
	remote.webContents.once("will-navigate", (event) => {
		navigated = event.defaultPrevented;
	});
	await run(remote, `location.href='http://localhost:${localPort}/'`);
	await new Promise((resolve) => setTimeout(resolve, 250));
	assert.equal(new URL(remote.webContents.getURL()).origin, remoteOrigin);
	assert(navigated);
	const beforeSettings = (await fetchJson(remote, "/api/updates")).body;
	const stale = await fetchJson(remote, "/api/updates/settings", {
		method: "PUT",
		headers: {
			"Content-Type": "application/json",
			"X-Factory-Request": "1",
			"X-Factory-Build": "obsolete-fixture-client",
		},
		body: JSON.stringify({
			revision: beforeSettings.revision,
			settings: { paused: true },
		}),
	});
	assert.equal(stale.status, 409);
	assert.equal(stale.body.code, "FACTORY_VERSION_MISMATCH");
	assert.deepEqual(
		(await fetchJson(remote, "/api/updates")).body,
		beforeSettings,
	);
	// Fulfill only version metadata at the native CDP response boundary, preserving host state.
	let mismatch = "protocol";
	remote.webContents.debugger.on("message", async (_event, method, params) => {
		if (method !== "Fetch.requestPaused") return;
		const data = await remote.webContents.debugger.sendCommand(
			"Fetch.getResponseBody",
			{ requestId: params.requestId },
		);
		const value = JSON.parse(
			data.base64Encoded
				? Buffer.from(data.body, "base64").toString()
				: data.body,
		);
		if (mismatch === "protocol") value.protocol = 99;
		else value.build = "obsolete-server-build-fixture";
		await remote.webContents.debugger.sendCommand("Fetch.fulfillRequest", {
			requestId: params.requestId,
			responseCode: 200,
			responseHeaders: [{ name: "Content-Type", value: "application/json" }],
			body: Buffer.from(JSON.stringify(value)).toString("base64"),
		});
	});
	await remote.webContents.debugger.sendCommand("Fetch.enable", {
		patterns: [{ urlPattern: "*/api/version", requestStage: "Response" }],
	});
	for (const fault of ["protocol", "build"]) {
		mismatch = fault;
		await run(remote, "location.reload()");
		await until(
			async () => /Factory updated\./.test(await text(remote)),
			`native ${fault} mismatch banner`,
		);
		assert.match(
			await text(remote),
			/Actions are paused|Update the app before signing in/,
		);
	}
	await remote.webContents.debugger.sendCommand("Fetch.disable");
	await run(remote, "location.reload()");
	await until(
		async () => /Choose your project/.test(await text(remote)),
		"guided onboarding",
	);
	await input(
		remote,
		"input[placeholder='~/code/my-project']",
		join(remoteHome, "missing"),
	);
	await input(remote, "select", "codex");
	await button(remote, "Continue");
	await until(
		async () =>
			/Cannot access repository|existing Git checkout/.test(await text(remote)),
		"invalid project feedback",
	);
	assert(!existsSync(join(remoteHome, "config.json")));
	await input(
		remote,
		"input[placeholder='~/code/my-project']",
		join(remoteHome, "project"),
	);
	await button(remote, "Continue");
	await until(
		async () => /Connect GitHub/.test(await text(remote)),
		"GitHub onboarding",
	);
	await input(remote, "input[type=password]", "denied-fixture");
	await button(remote, "Connect GitHub");
	await until(
		async () => /cannot read the project's PR/.test(await text(remote)),
		"denied readiness feedback",
	);
	assert(!existsSync(join(remoteHome, "github-auth.json")));
	await input(remote, "input[type=password]", "accepted-fixture");
	await button(remote, "Connect GitHub");
	await until(
		async () => /You’re ready to build/.test(await text(remote)),
		"onboarding ready",
	);
	assert.equal(
		JSON.parse(readFileSync(join(remoteHome, "config.json"), "utf8"))
			.defaultRunner,
		"codex",
	);
	assert.equal(
		JSON.parse(readFileSync(join(remoteHome, "github-auth.json"), "utf8"))
			.hosts["github.com"].account,
		"fixture-operator",
	);
	writeFileSync(
		join(root, "onboarding.png"),
		(await remote.webContents.capturePage()).toPNG(),
	);
	writeFileSync(join(root, "disconnect-proxy"), "transport failure\n");
	await run(remote, "location.reload()");
	await until(
		async () => /Can’t reach the factory/.test(await text(remote)),
		"native connection loss guidance",
	);
	alive(settings.remotePid);
	alive(worker.pid);
	unlinkSync(join(root, "disconnect-proxy"));
	await run(remote, "location.reload()");
	await until(
		async () =>
			(await fetchJson(remote, "/api/auth/status")).body.authenticated,
		"same session after connection restored",
	);
	const errorCount = errors.length;
	menu("Stop local Factory…");
	await until(() => errors.length > errorCount, "remote Stop rejected");
	assert.match(errors.at(-1).message, /Remote and independent/);
	alive(settings.remotePid);
	alive(worker.pid);
	alive(jobPid);
	alive(descendantPid);
	remote.close();
	menu("Open Factory");
	assert(remote.isVisible());
	assert.equal(
		(await fetchJson(remote, "/api/auth/status")).body.authenticated,
		true,
	);
	assert.deepEqual(
		(await fetchJson(remote, "/api/updates")).body,
		beforeSettings,
	);
	await fetchJson(remote, "/api/auth/logout", {
		method: "POST",
		headers: { "Content-Type": "application/json", "X-Factory-Request": "1" },
		body: "{}",
	});
	await run(remote, "location.reload()");
	await button(remote, "Sign in with passkey");
	await until(
		async () =>
			(await fetchJson(remote, "/api/auth/status")).body.authenticated,
		"remote native login after logout",
	);
	assert.equal(owner(localHome).pid, worker.pid);
	writeFileSync(
		join(root, "phase-first.json"),
		JSON.stringify(
			{
				passed: true,
				workerPid: worker.pid,
				workerNonce: worker.nonce,
				jobPid,
				descendantPid,
				electron: process.versions.electron,
				identity,
				remoteOrigin,
				auth: "CDP virtual CTAP2 / separate persistent origin partitions",
				remoteStopRejected: true,
				sessionTransplantRejected: true,
				navigationRejected: true,
				staleWriteRejected: true,
				protocolAndBuildMismatchPaused: true,
				connectionLossAndSessionRecovery: true,
				mountedShellFiles: Object.fromEntries(
					[
						"main.mjs",
						"contracts.mjs",
						"local-runtime.mjs",
						"preload.cjs",
						"launcher.html",
						"launcher.js",
						"launcher.css",
					].map((file) => [
						file,
						createHash("sha256")
							.update(
								readFileSync(
									join(
										fileURLToPath(
											new URL(
												".",
												mainPath.startsWith("file:")
													? mainPath
													: `file://${mainPath}`,
											),
										),
										file,
									),
								),
							)
							.digest("hex"),
					]),
				),
				onboarding:
					"real validation / synthetic GitHub / prepared fake command",
				errors,
			},
			null,
			2,
		),
	);
	// Actual UI process quits here. Parent launches a new process with the same profile.
	menu("Quit desktop UI");
}
void main().catch((error) => {
	console.error(error);
	console.error(JSON.stringify({ root, errors }));
	app.exit(1);
});
