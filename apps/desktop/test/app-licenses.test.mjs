import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareElectronLicenses } from "../../../scripts/lib/desktop-licenses.mjs";
import { packApp, unpackApp } from "../src/app-archive.mjs";
import {
	validateElectronLicenses,
	verifyElectronLicenses,
} from "../src/app-licenses.mjs";

test("packaging requires exact pinned vendor notices; recovery retains bytes and missing/tampered notices fail closed", () => {
	const root = mkdtempSync(join(tmpdir(), "notice-test-"));
	try {
		const dist = join(root, "node_modules", "electron", "dist");
		mkdirSync(dist, { recursive: true });
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({ devDependencies: { electron: "44.7.0" } }),
		);
		writeFileSync(join(dist, "version"), "44.7.0");
		writeFileSync(join(dist, "LICENSE"), "Controlled license test");
		assert.throws(() => prepareElectronLicenses(root), /ENOENT/);
		writeFileSync(
			join(dist, "LICENSES.chromium.html"),
			"Controlled Chromium test",
		);
		const expected = prepareElectronLicenses(root);
		const extracted = join(root, "restored");
		mkdirSync(extracted);
		unpackApp(
			packApp(join(root, "electron-licenses")),
			join(extracted, "electron-licenses"),
		);
		assert.deepEqual(verifyElectronLicenses(extracted, expected), expected);
		writeFileSync(join(extracted, "electron-licenses", "LICENSE"), "tampered");
		assert.throws(() => verifyElectronLicenses(extracted, expected), /differ/);
		assert.throws(() => validateElectronLicenses(undefined), /Missing/);
		assert.throws(
			() =>
				validateElectronLicenses({
					...expected,
					files: expected.files.slice(0, 1),
				}),
			/Missing/,
		);
		writeFileSync(join(dist, "version"), "44.6.0");
		assert.throws(() => prepareElectronLicenses(root), /pinned/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
