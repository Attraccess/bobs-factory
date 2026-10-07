import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Injected by scripts/build-binary.ts. Checkout builds use their package files.
declare const BOBS_FACTORY_ASSETS: {
	digest: string;
	files: Record<string, { sha256: string; data: string }>;
};
declare const BOBS_FACTORY_VERSION: string;
export const isPackagedExecutable = typeof BOBS_FACTORY_ASSETS !== "undefined";
export const factoryVersion =
	typeof BOBS_FACTORY_VERSION === "undefined"
		? "development"
		: BOBS_FACTORY_VERSION;
let resourceRoot: string | undefined;

/** Immutable, content-addressed resources needing real paths (skills, prompts). */
export function runtimeAssetPath(relative: string, checkout: string): string {
	if (!isPackagedExecutable) return checkout;
	if (!resourceRoot) {
		const bundle = BOBS_FACTORY_ASSETS;
		if (
			createHash("sha256")
				.update(JSON.stringify(bundle.files))
				.digest("hex") !== bundle.digest
		)
			throw new Error("Invalid executable resource inventory");
		const parent = join(homedir(), ".bobs-factory", "resources");
		mkdirSync(parent, { recursive: true, mode: 0o700 });
		for (const directory of [dirname(parent), parent]) {
			const stat = lstatSync(directory);
			if (!stat.isDirectory() || stat.isSymbolicLink())
				throw new Error("Resource storage must use real directories");
		}
		const root = join(parent, bundle.digest);
		const verify = () => {
			if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink())
				throw new Error("Invalid resource directory");
			for (const [name, file] of Object.entries(bundle.files)) {
				const path = join(root, name);
				let directory = dirname(path);
				while (directory !== root) {
					const stat = lstatSync(directory);
					if (!stat.isDirectory() || stat.isSymbolicLink())
						throw new Error(`Invalid resource parent: ${name}`);
					directory = dirname(directory);
				}
				if (
					lstatSync(path).isSymbolicLink() ||
					createHash("sha256").update(readFileSync(path)).digest("hex") !==
						file.sha256
				)
					throw new Error(`Resource integrity failure: ${name}`);
			}
		};
		if (!existsSync(root)) {
			const stage = mkdtempSync(join(parent, ".stage-"));
			try {
				for (const [name, file] of Object.entries(bundle.files)) {
					if (
						name.startsWith("/") ||
						name.split("/").some((part) => part === ".." || !part)
					)
						throw new Error("Invalid resource path");
					const path = join(stage, name);
					mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
					writeFileSync(path, Buffer.from(file.data, "base64"), {
						mode: 0o400,
					});
				}
				try {
					renameSync(stage, root);
				} catch (error) {
					if (
						!["EEXIST", "ENOTEMPTY"].includes(
							(error as NodeJS.ErrnoException).code ?? "",
						)
					)
						throw error;
				}
			} finally {
				rmSync(stage, { recursive: true, force: true });
			}
		}
		verify();
		resourceRoot = root;
	}
	return join(resourceRoot, relative);
}
