import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** Resolve symlinked ancestors even when the final destination does not exist. */
export function canonicalPath(path: string): string {
	let parent = resolve(path);
	const suffix: string[] = [];
	while (!existsSync(parent)) {
		suffix.unshift(basename(parent));
		const ancestor = dirname(parent);
		if (ancestor === parent) throw new Error("Cannot resolve migration path");
		parent = ancestor;
	}
	return join(realpathSync(parent), ...suffix);
}
