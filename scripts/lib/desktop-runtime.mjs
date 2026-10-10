import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
export function desktopRuntime(directory, { commit, version, target }) {
	const identity = JSON.parse(
		readFileSync(join(directory, "build.json"), "utf8"),
	);
	if (
		identity.product !== "bobs-factory" ||
		identity.version !== version ||
		identity.commit !== commit ||
		identity.target !== target
	)
		throw new Error("Desktop/runtime frozen identity mismatch");
	const path = join(directory, "bobs-factory");
	if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())
		throw new Error("Packaged runtime must be a regular executable");
	const bytes = readFileSync(path);
	if (
		identity.executable?.size !== bytes.length ||
		identity.executable?.sha256 !==
			createHash("sha256").update(bytes).digest("hex")
	)
		throw new Error("Desktop runtime integrity mismatch");
	return identity;
}
