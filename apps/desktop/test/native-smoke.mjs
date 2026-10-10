// Actual Electron shell + native local runtime; CDP virtual authenticator, no provider.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow, dialog, Menu } from "electron";

if (process.platform === "linux") app.disableHardwareAcceleration();
const root = mkdtempSync(join(tmpdir(), "factory-electron-smoke-"));
process.env.BOBS_FACTORY_DESKTOP_HOME = join(root, "home");
process.env.BOBS_FACTORY_DESKTOP_PORT = "3973";
if (!process.env.BOBS_FACTORY_DESKTOP_BINARY)
	throw new Error("Provide a matching native runtime binary");
app.setPath("userData", join(root, "profile"));
dialog.showErrorBox = (title, message) => {
	throw new Error(`${title}: ${message}`);
};
dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
let workerPid;
let reportedError;
let screenshotUnavailable;
dialog.showErrorBox = (title, message) => {
	reportedError = `${title}: ${message}`;
};
const until = async (check) => {
	const deadline = Date.now() + 15000;
	while (!(await check())) {
		assert.ok(Date.now() < deadline, "Native fixture wait timed out");
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
};
void (async () => {
	try {
		await import("../src/main.mjs");
		await app.whenReady();
		await until(() => BrowserWindow.getAllWindows().length === 1);
		const launcher = BrowserWindow.getAllWindows()[0];
		await until(() => !launcher.webContents.isLoading());
		await launcher.webContents.executeJavaScript(
			"window.factoryLauncher.connect(null)",
		);
		const dashboard = BrowserWindow.getAllWindows().find((w) => w !== launcher);
		assert.ok(dashboard);
		const getOwner = () =>
			JSON.parse(
				readlinkSync(
					join(process.env.BOBS_FACTORY_DESKTOP_HOME, "runtime", "worker.lock"),
				),
			);
		workerPid = getOwner().pid;
		assert.equal(getOwner().owner, "desktop");
		assert.equal(
			await dashboard.webContents.executeJavaScript("typeof require"),
			"undefined",
		);
		assert.equal(
			await dashboard.webContents.executeJavaScript(
				"typeof window.factoryLauncher",
			),
			"undefined",
		);
		dashboard.webContents.debugger.attach("1.3");
		await dashboard.webContents.debugger.sendCommand("WebAuthn.enable");
		await dashboard.webContents.debugger.sendCommand(
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
		await until(() =>
			dashboard.webContents.executeJavaScript(
				"Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Create passkey'&&!b.disabled)",
			),
		);
		await dashboard.webContents.executeJavaScript(
			"Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Create passkey').click()",
			true,
		);
		await until(async () => {
			const status = await dashboard.webContents.executeJavaScript(
				"fetch('/api/auth/status').then(r=>r.json())",
			);
			return status.authenticated;
		});
		const config = await dashboard.webContents.executeJavaScript(
			"fetch('/api/config').then(r=>r.json())",
		);
		assert.equal(config.onboarding.required, true);
		try {
			const screenshot = await dashboard.webContents.capturePage();
			writeFileSync(join(root, "onboarding.png"), screenshot.toPNG());
		} catch (error) {
			if (process.platform !== "linux" || error.message !== "UnknownVizError")
				throw error;
			screenshotUnavailable =
				"Xvfb compositor UnknownVizError; authenticated DOM and native menu checks continue";
		}
		dashboard.close();
		assert.equal(dashboard.isDestroyed(), false);
		assert.equal(dashboard.isVisible(), false);
		process.kill(workerPid, 0);
		const menu = Menu.getApplicationMenu();
		menu.items[0].submenu.items.find((i) => i.label === "Open Factory").click();
		assert.equal(dashboard.isVisible(), true);
		assert.equal(getOwner().pid, workerPid);
		await dashboard.webContents.executeJavaScript(
			"fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json','X-Factory-Request':'1'},body:'{}'}).then(r=>r.json())",
		);
		await dashboard.webContents.executeJavaScript("location.reload()");
		await until(() => !dashboard.webContents.isLoading());
		await until(() =>
			dashboard.webContents.executeJavaScript(
				"Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Sign in with passkey'&&!b.disabled)",
			),
		);
		await dashboard.webContents.executeJavaScript(
			"Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Sign in with passkey').click()",
			true,
		);
		await until(() =>
			dashboard.webContents.executeJavaScript(
				"fetch('/api/auth/status').then(r=>r.json()).then(s=>s.authenticated)",
			),
		);
		// Hold the real menu confirmation while the external owner admits maintenance.
		const { OwnedUpdateLifecycle } = await import(
			"../../cli/dist/src/services/OwnedUpdateLifecycle.js"
		);
		const { UpdateManager } = await import(
			"../../../packages/edge-worker/dist/updates/UpdateManager.js"
		);
		const identity = JSON.parse(
			readFileSync(
				join(process.env.BOBS_FACTORY_DESKTOP_BINARY, "..", "build.json"),
				"utf8",
			),
		);
		class ConfirmationLifecycle extends OwnedUpdateLifecycle {
			async isIdle() {
				await super.isIdle();
				confirm({ response: 1 });
				await until(() => reportedError);
				return false; // Controlled busy decision: no native replacement in this menu fixture.
			}
		}
		const lifecycle = new ConfirmationLifecycle(
			process.env.BOBS_FACTORY_DESKTOP_HOME,
			Number(process.env.BOBS_FACTORY_DESKTOP_PORT),
		);
		// Own only this fixture's exact external supervisor while a controlled source is selected.
		const supervisorLock = join(
			lifecycle.home,
			"runtime",
			"update-supervisor.lock",
		);
		const supervisorRecord = () => {
			try {
				return JSON.parse(readlinkSync(supervisorLock));
			} catch (error) {
				if (error.code === "ENOENT") return;
				throw error;
			}
		};
		await until(() => supervisorRecord());
		const supervisorOwner = supervisorRecord();
		const { ownerAlive, workerOwner } = await import(
			"../../cli/dist/src/services/InstanceLock.js"
		);
		assert.equal(supervisorOwner.home, lifecycle.home);
		assert.equal(
			supervisorOwner.executable,
			realpathSync(lifecycle.runtimeLink),
		);
		assert.equal(supervisorOwner.owner, "desktop");
		assert(ownerAlive(supervisorOwner));
		process.kill(supervisorOwner.pid, "SIGTERM");
		await until(() => !supervisorRecord());
		const candidate = {
			...identity,
			version: "9.0.0-nightly.20261010.1",
			channel: "nightly",
			manifestSha256: "a".repeat(64),
			publishedAt: new Date().toISOString(),
		};
		const manager = new UpdateManager(
			process.env.BOBS_FACTORY_DESKTOP_HOME,
			{
				discover: async () => candidate,
				stage: async () => ({
					candidate,
					executable: realpathSync(process.env.BOBS_FACTORY_DESKTOP_BINARY),
					previousExecutable: realpathSync(
						process.env.BOBS_FACTORY_DESKTOP_BINARY,
					),
				}),
			},
			lifecycle,
			identity,
		);
		manager.configure(
			{ channel: "nightly", policy: "idle-auto" },
			manager.status().revision,
		);
		await manager.check();
		await manager.stage();
		let confirm, entered;
		const shown = new Promise((resolve) => {
			entered = resolve;
		});
		dialog.showMessageBox = async (options) => {
			if (!options.buttons) return { response: 0 };
			entered();
			return new Promise((resolve) => {
				confirm = resolve;
			});
		};
		menu.items[0].submenu.items
			.find((i) => i.label === "Stop local Factory…")
			.click();
		await shown;
		const postponed = await manager.reconcile();
		assert.equal(postponed.transaction.phase, "cancelled");
		assert.match(reportedError, /maintenance/);
		assert.equal(getOwner().pid, workerPid);
		assert.equal(
			existsSync(
				join(
					process.env.BOBS_FACTORY_DESKTOP_HOME,
					"runtime",
					"desktop-stopped.json",
				),
			),
			false,
		);

		reportedError = undefined;
		let stopReported = false;
		dialog.showMessageBox = async (options) => {
			if (
				options.message ===
				"Factory stopped. Open local Factory to start it again."
			)
				stopReported = true;
			return { response: 1 };
		};
		// Native menu confirms explicit Stop; UI close never did.
		menu.items[0].submenu.items
			.find((i) => i.label === "Stop local Factory…")
			.click();
		await until(() => {
			try {
				getOwner();
				return false;
			} catch (error) {
				return error.code === "ENOENT";
			}
		});
		await until(() => stopReported);
		workerPid = undefined;
		await assert.rejects(lifecycle.start(), /Deliberate Stop/);
		await lifecycle.restartCrashedDesktop();
		execFileSync(
			lifecycle.runtimeLink,
			[
				"--home",
				lifecycle.home,
				"--port",
				process.env.BOBS_FACTORY_DESKTOP_PORT,
				"service",
				"updates-run",
				"--once",
			],
			{ encoding: "utf8", timeout: 15000 },
		);
		assert.equal(workerOwner(lifecycle.home), undefined);
		console.log(
			JSON.stringify(
				{
					passed: true,
					platform: process.platform,
					arch: process.arch,
					electron: process.versions.electron,
					fixture: root,
					auth: "CDP virtual authenticator enrollment/login/logout",
					closedWindowKeepsWorker: true,
					reopenSamePid: true,
					explicitStop: true,
					confirmationMaintenanceRaceRejected: true,
					stopSuppressesAutomaticRestart: true,
					nativeCredentials: "not tested",
					screenshotUnavailable,
				},
				null,
				2,
			),
		);
		app.exit(0);
	} catch (error) {
		if (workerPid)
			try {
				process.kill(workerPid, "SIGTERM");
			} catch {}
		console.error(error);
		app.exit(1);
	}
})();
