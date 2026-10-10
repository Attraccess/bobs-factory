import { spawn } from "node:child_process";
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	Menu,
	session,
	shell,
} from "electron";
import {
	allowedNavigation,
	connectionOrigin,
	connectionPartition,
	externalLink,
} from "./contracts.mjs";
import { desktopExecutable } from "./local-runtime.mjs";

const source = dirname(fileURLToPath(import.meta.url));
const launcherUrl = pathToFileURL(join(source, "launcher.html")).href;
const home =
	process.env.BOBS_FACTORY_DESKTOP_HOME ?? join(homedir(), ".bobs-factory");
const binary =
	process.env.BOBS_FACTORY_DESKTOP_BINARY ??
	join(process.resourcesPath, "runtime", "bobs-factory");
const port = Number(process.env.BOBS_FACTORY_DESKTOP_PORT ?? 3457);
let window,
	launcher,
	selected,
	quitting = false;
let runtimeBinary = binary;
// One application process; the worker also independently locks its canonical home.
if (!app.requestSingleInstanceLock()) app.quit();
else {
	app.on("second-instance", () => show());
	app.on("window-all-closed", () => {});
	app.on("before-quit", () => {
		quitting = true;
	});
	app.on("activate", () => show());
	app
		.whenReady()
		.then(() => {
			if (
				process.platform === "darwin" &&
				process.env.BOBS_FACTORY_WEBAUTHN_ACCESS_GROUP
			)
				app.configureWebAuthn({
					touchID: {
						keychainAccessGroup: process.env.BOBS_FACTORY_WEBAUTHN_ACCESS_GROUP,
						promptReason: "sign in to $1",
					},
				});
			installMenu();
			showLauncher();
		})
		.catch((error) =>
			dialog.showErrorBox("Factory launch failed", error.message),
		);
}
function owner() {
	const p = join(home, "runtime", "worker.lock");
	let value;
	try {
		value = readlinkSync(p);
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
	const o = JSON.parse(value);
	if (
		o.schema !== 1 ||
		o.home !== realpathSync(home) ||
		!Number.isInteger(o.pid) ||
		typeof o.nonce !== "string"
	)
		throw new Error(
			"Invalid local worker ownership; reconcile through the CLI",
		);
	return o;
}
function protect(win, origin) {
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (externalLink(url)) void shell.openExternal(url);
		return { action: "deny" };
	});
	win.webContents.on("will-navigate", (event, url) => {
		if (!allowedNavigation(url, origin)) event.preventDefault();
	});
	win.webContents.on("will-redirect", (event, url) => {
		if (!allowedNavigation(url, origin)) event.preventDefault();
	});
	win.on("close", (event) => {
		if (!quitting) {
			event.preventDefault();
			win.hide();
		}
	});
}
function show() {
	if (window && !window.isDestroyed()) {
		window.show();
		window.focus();
	} else showLauncher();
}
function showLauncher() {
	if (launcher && !launcher.isDestroyed()) {
		launcher.show();
		launcher.focus();
		return;
	}
	launcher = new BrowserWindow({
		width: 760,
		height: 640,
		title: "Bob's Factory",
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			preload: join(source, "preload.cjs"),
			partition: "launcher",
		},
	});
	launcher.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	launcher.webContents.on("will-navigate", (event, url) => {
		if (url !== launcherUrl) event.preventDefault();
	});
	void launcher.loadURL(launcherUrl);
}
ipcMain.handle("launcher-connect", async (event, remote) => {
	if (
		!launcher ||
		event.sender !== launcher.webContents ||
		event.senderFrame !== launcher.webContents.mainFrame ||
		event.senderFrame.url !== launcherUrl
	)
		throw new Error("Unauthorized launcher request");
	if (remote !== null && typeof remote !== "string")
		throw new Error("Invalid connection");
	const origin = remote === null ? await local() : connectionOrigin(remote);
	selected = { origin, local: remote === null };
	await openDashboard(origin);
	launcher.hide();
});
async function local() {
	if (!Number.isInteger(port) || port < 1 || port >= 65535)
		throw new Error("Invalid local dashboard port");
	mkdirSync(home, { recursive: true, mode: 0o700 });
	const current = owner();
	if (current && current.dashboardPort !== port)
		throw new Error(
			`Existing Factory uses port ${current.dashboardPort}. Set the local desktop port to attach`,
		);
	if (!current) {
		if (existsSync(join(home, "runtime", "update-owner.json")))
			throw new Error(
				"This instance is in update maintenance. Reconnect after verified replacement/recovery",
			);
		if (existsSync(join(home, "runtime", "worker.lock")))
			throw new Error(
				"Interrupted worker ownership; use CLI reconciliation before starting",
			);
		if (existsSync(join(home, "runtime", "service.json")))
			throw new Error(
				"This home is service-owned. Start it through service controls and reconnect",
			);
		if (!existsSync(binary))
			throw new Error("Packaged Factory runtime is missing");
		runtimeBinary = desktopExecutable(home, dirname(binary));
		mkdirSync(join(home, "runtime"), { recursive: true, mode: 0o700 });
		const log = openSync(
			join(home, "runtime", "desktop-worker.log"),
			"a",
			0o600,
		);
		const child = spawn(
			runtimeBinary,
			["--home", home, "--port", String(port), "--no-open", "local"],
			{
				detached: true,
				stdio: ["ignore", log, log],
				env: { ...process.env, BOBS_FACTORY_DESKTOP_OWNER: "1" },
			},
		);
		closeSync(log);
		child.unref();
		const failed = new Promise((_, reject) => child.once("error", reject));
		await Promise.race([waitForFactory(), failed]);
	} else {
		if (existsSync(join(home, "runtime", "desktop-runtime.json")))
			runtimeBinary = JSON.parse(
				readFileSync(join(home, "runtime", "desktop-runtime.json"), "utf8"),
			).executable;
		await waitForFactory();
	}
	rmSync(join(home, "runtime", "desktop-stopped.json"), { force: true });
	const log = openSync(
		join(home, "runtime", "desktop-updates.log"),
		"a",
		0o600,
	);
	const supervisor = spawn(
		runtimeBinary,
		[
			"--home",
			home,
			"--port",
			String(port),
			"--no-open",
			"service",
			"updates-run",
		],
		{
			detached: true,
			stdio: ["ignore", log, log],
			env: { ...process.env, BOBS_FACTORY_DESKTOP_OWNER: "1" },
		},
	);
	supervisor.on("error", (error) =>
		dialog.showErrorBox("Update supervisor failed", error.message),
	);
	supervisor.unref();
	closeSync(log);
	return `http://localhost:${port}`;
}
async function waitForFactory() {
	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			const response = await fetch(`http://localhost:${port}/api/auth/status`, {
				signal: AbortSignal.timeout(500),
			});
			const value = await response.json();
			const current = owner();
			if (
				response.ok &&
				value.origin === `http://localhost:${port}` &&
				current
			) {
				process.kill(current.pid, 0);
				return;
			}
		} catch {}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error(
		"Factory did not become ready. Inspect runtime/desktop-worker.log; existing services may use a different port",
	);
}
async function openDashboard(origin) {
	if (window && !window.isDestroyed()) window.destroy();
	const partition = connectionPartition(origin);
	const isolated = session.fromPartition(partition);
	isolated.setPermissionRequestHandler((_wc, _permission, callback) =>
		callback(false),
	);
	isolated.setPermissionCheckHandler(() => false);
	window = new BrowserWindow({
		width: 1280,
		height: 850,
		minWidth: 640,
		title: "Bob's Factory",
		webPreferences: {
			partition,
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			webSecurity: true,
			allowRunningInsecureContent: false,
		},
	});
	protect(window, origin);
	window.webContents.on("did-fail-load", (_event, code, description) => {
		if (code !== -3)
			dialog.showErrorBox(
				"Factory connection failed",
				`${description}\nUse Factory → Connect to retry.`,
			);
	});
	let fragment = "";
	if (selected.local) {
		const grant = join(home, "factory", "auth", "enroll.json");
		const state = join(home, "factory", "auth", "state.json");
		if (
			existsSync(grant) &&
			existsSync(state) &&
			JSON.parse(readFileSync(state, "utf8")).credentials.length === 0
		) {
			const value = JSON.parse(readFileSync(grant, "utf8"));
			if (value.expires > Date.now())
				fragment = `#setup=${encodeURIComponent(value.token)}`;
		}
	}
	await window.loadURL(`${origin}/${fragment}`);
}
async function stopLocal() {
	if (!selected?.local)
		throw new Error(
			"Select a local desktop-owned Factory. Remote and independent services are stopped by their owner",
		);
	if (existsSync(join(home, "runtime", "update-owner.json")))
		throw new Error(
			"An update owns maintenance; wait for completion or recovery before Stop",
		);
	const o = owner();
	if (
		!o ||
		o.owner !== "desktop" ||
		o.executable !== realpathSync(runtimeBinary)
	)
		throw new Error(
			"This worker is independently owned; use its service/foreground controls",
		);
	// PID-only signaling is unsafe. Prove the live process command/home before signaling.
	const { execFileSync } = await import("node:child_process");
	const command = execFileSync(
		"/bin/ps",
		["-p", String(o.pid), "-o", "comm="],
		{ encoding: "utf8" },
	).trim();
	const stamp = execFileSync(
		"/bin/ps",
		["-p", String(o.pid), "-o", "lstart="],
		{ encoding: "utf8" },
	).trim();
	if (
		stamp !== o.processStamp ||
		realpathSync(command) !== o.executable ||
		owner()?.nonce !== o.nonce
	)
		throw new Error("Worker identity changed; refusing shutdown");
	const { response } = await dialog.showMessageBox({
		type: "warning",
		buttons: ["Cancel", "Stop Factory"],
		defaultId: 0,
		cancelId: 0,
		message: "Stop the local Factory?",
		detail:
			"Running work is shut down through the normal worker lifecycle. Saved checkpoints remain in the same home. Closing the window keeps jobs running.",
	});
	if (response !== 1) return;
	if (owner()?.nonce !== o.nonce) throw new Error("Worker identity changed");
	writeFileSync(
		join(home, "runtime", "desktop-stopped.json"),
		JSON.stringify({ stoppedAt: new Date().toISOString() }),
		{ mode: 0o600 },
	);
	process.kill(o.pid, "SIGTERM");
	for (let n = 0; n < 300; n++) {
		if (!owner()) {
			dialog.showMessageBox({
				message: "Factory stopped. Open local Factory to start it again.",
			});
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error(
		"Worker still owns this home. No replacement was started; inspect its logs",
	);
}
function installMenu() {
	Menu.setApplicationMenu(
		Menu.buildFromTemplate([
			{
				label: "Factory",
				submenu: [
					{ label: "Open Factory", click: show },
					{ label: "Connect…", click: showLauncher },
					{
						label: "Stop local Factory…",
						click: () =>
							stopLocal().catch((error) =>
								dialog.showErrorBox("Factory stop failed", error.message),
							),
					},
					{ type: "separator" },
					{ label: "Quit desktop UI", click: () => app.quit() },
				],
			},
			{ role: "editMenu" },
			{ role: "viewMenu" },
			{ role: "windowMenu" },
		]),
	);
}
