// Actual Electron shell + native local runtime; CDP virtual authenticator, no provider.

import assert from "node:assert/strict";
import { mkdtempSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow, dialog, Menu } from "electron";

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
		const screenshot = await dashboard.webContents.capturePage();
		writeFileSync(join(root, "onboarding.png"), screenshot.toPNG());
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
		workerPid = undefined;
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
					nativeCredentials: "not tested",
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
