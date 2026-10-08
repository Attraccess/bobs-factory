import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
	isPackagedExecutable,
	preparedExecutable,
	resolvePath,
} from "bobs-factory-core";

/** Shared by packaged SDK startup and capability inspection. */
export function resolvePreparedCursorInstallation(): {
	sdk: string;
	node: string;
	version: string;
} {
	const configured = process.env.BOBS_FACTORY_CURSOR_SDK_PATH;
	if (!configured)
		throw new Error(
			"Cursor requires a user-prepared @cursor/sdk 1.0.19 installation. Set BOBS_FACTORY_CURSOR_SDK_PATH to its package directory and BOBS_FACTORY_CURSOR_NODE to Node >=22.13 (or put Node on PATH). See docs/distribution/README.md. Bob’s Factory does not install or authenticate Cursor.",
		);
	const sdk = realpathSync(resolvePath(configured));
	const version = sdkVersion(sdk);
	const node = preparedExecutable(
		process.env.BOBS_FACTORY_CURSOR_NODE || "node",
	);
	return { sdk, node, version };
}

export function resolveCursorInstallation(): {
	sdk: string;
	node?: string;
	version: string;
} {
	if (isPackagedExecutable) return resolvePreparedCursorInstallation();
	const require = createRequire(import.meta.url);
	const sdk = join(dirname(require.resolve("@cursor/sdk")), "..", "..");
	return { sdk, version: sdkVersion(sdk) };
}

function sdkVersion(sdk: string): string {
	const pkg = JSON.parse(readFileSync(join(sdk, "package.json"), "utf8"));
	if (pkg.name !== "@cursor/sdk" || pkg.version !== "1.0.19")
		throw new Error(
			"Prepared Cursor installation must be @cursor/sdk 1.0.19; preserve native session compatibility before upgrading.",
		);
	return pkg.version;
}
