import { execFileSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	electronLicenses,
	verifyElectronLicenses,
} from "../../apps/desktop/src/app-licenses.mjs";

// Use the distribution shipped by the exact pinned Electron package, not a
// separately fetched notice or a source-tree license from another version.
export function prepareElectronLicenses(app) {
	const dist = join(app, "node_modules", "electron", "dist"),
		version = readFileSync(join(dist, "version"), "utf8").trim(),
		pin = JSON.parse(readFileSync(join(app, "package.json"))).devDependencies
			.electron;
	if (version !== pin)
		throw Error("Electron distribution differs from pinned package");
	const expected = electronLicenses(dist, version),
		directory = join(app, "electron-licenses");
	mkdirSync(directory, { recursive: true });
	for (const record of expected.files)
		cpSync(join(dist, record.file), join(directory, record.file));
	verifyElectronLicenses(app, expected);
	return expected;
}
function resourcesUnder(root) {
	const found = [];
	function walk(directory) {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const path = join(directory, entry.name);
			if (entry.name === "electron-licenses") found.push(directory);
			else walk(path);
		}
	}
	walk(root);
	if (found.length !== 1)
		throw Error("Installer must contain one Electron license distribution");
	return found[0];
}
export function verifyDesktopInstallerLicenses(file, expected) {
	file = resolve(file);
	const root = mkdtempSync(join(tmpdir(), "desktop-notices-"));
	let mounted = false;
	try {
		if (file.endsWith(".dmg")) {
			const mount = join(root, "mounted");
			mkdirSync(mount);
			execFileSync(
				"/usr/bin/hdiutil",
				["attach", "-readonly", "-nobrowse", "-mountpoint", mount, file],
				{ stdio: "pipe" },
			);
			mounted = true;
			return verifyElectronLicenses(
				join(mount, "Bob's Factory.app", "Contents", "Resources"),
				expected,
			);
		}
		if (file.endsWith(".AppImage")) {
			// This only runs a locally built candidate on its native build host. The
			// production updater does not execute an unactivated image to read notices.
			execFileSync(file, ["--appimage-extract"], { cwd: root, stdio: "pipe" });
		} else if (file.endsWith(".deb")) {
			execFileSync("dpkg-deb", ["--extract", file, root], { stdio: "pipe" });
		} else throw Error("Unsupported desktop installer license inspection");
		return verifyElectronLicenses(resourcesUnder(root), expected);
	} finally {
		if (mounted)
			execFileSync("/usr/bin/hdiutil", ["detach", join(root, "mounted")], {
				stdio: "pipe",
			});
		rmSync(root, { recursive: true, force: true });
	}
}
