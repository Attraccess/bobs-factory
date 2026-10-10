import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const electronLicenseFiles = ["LICENSE", "LICENSES.chromium.html"];
export function validateElectronLicenses(value) {
	if (
		value?.schemaVersion !== 1 ||
		value.product !== "electron" ||
		!/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(value.version ?? "") ||
		value.files?.length !== electronLicenseFiles.length ||
		!electronLicenseFiles.every((file, i) => {
			const record = value.files[i];
			return (
				record?.file === file &&
				Number.isSafeInteger(record.size) &&
				record.size > 0 &&
				/^[a-f0-9]{64}$/.test(record.sha256 ?? "")
			);
		})
	)
		throw Error("Missing or invalid Electron/Chromium license inventory");
	return value;
}
export function electronLicenses(directory, version) {
	return validateElectronLicenses({
		schemaVersion: 1,
		product: "electron",
		version,
		files: electronLicenseFiles.map((file) => {
			const path = join(directory, file);
			if (!lstatSync(path).isFile())
				throw Error("License must be a regular file");
			const bytes = readFileSync(path);
			return {
				file,
				size: bytes.length,
				sha256: createHash("sha256").update(bytes).digest("hex"),
			};
		}),
	});
}
export function verifyElectronLicenses(resources, expected) {
	validateElectronLicenses(expected);
	const directory = join(resources, "electron-licenses");
	if (!lstatSync(directory).isDirectory())
		throw Error("Missing packaged Electron licenses");
	const actual = electronLicenses(directory, expected.version);
	if (JSON.stringify(actual) !== JSON.stringify(expected))
		throw Error(
			"Packaged Electron/Chromium license bytes differ from inventory",
		);
	return actual;
}
