import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
export function desktopExecutable(home, runtime) {
	home = realpathSync(home);
	const prefix = join(home, "runtime", "desktop-installed"),
		link = join(prefix, "bin", "bobs-factory"),
		record = join(home, "runtime", "desktop-runtime.json");
	if (existsSync(record)) {
		const value = JSON.parse(readFileSync(record, "utf8"));
		if (
			value.schema !== 1 ||
			value.home !== home ||
			value.executable !== link ||
			!lstatSync(link).isSymbolicLink()
		)
			throw new Error("Desktop runtime ownership mismatch");
		return link; // Preserve an already updated runtime; an older shell cannot roll it back.
	}
	const identity = JSON.parse(
		readFileSync(join(runtime, "build.json"), "utf8"),
	);
	if (
		identity.product !== "bobs-factory" ||
		identity.target !== `${process.platform}-${process.arch}` ||
		!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(identity.version)
	)
		throw new Error("Packaged desktop runtime identity mismatch");
	const executable = join(runtime, "bobs-factory"),
		bytes = readFileSync(executable);
	if (
		!lstatSync(executable).isFile() ||
		lstatSync(executable).isSymbolicLink() ||
		identity.executable?.sha256 !==
			createHash("sha256").update(bytes).digest("hex") ||
		identity.executable.size !== bytes.length
	)
		throw new Error("Packaged desktop runtime integrity failure");
	const target = join(
		prefix,
		"lib",
		"bobs-factory",
		`bobs-factory-${identity.version}-${identity.target}`,
	);
	if (existsSync(target))
		throw new Error(
			"Interrupted desktop runtime setup: reconcile retained bytes before retry",
		);
	const ensureRegular = (path) => {
		const stat = lstatSync(path);
		if (stat.isDirectory()) {
			for (const name of awaitNames(path)) ensureRegular(join(path, name));
		} else if (!stat.isFile() || stat.isSymbolicLink())
			throw new Error("Desktop runtime contains external/special files");
	};
	ensureRegular(resolve(runtime));
	mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
	cpSync(runtime, target, {
		recursive: true,
		errorOnExist: true,
		force: false,
	});
	mkdirSync(dirname(link), { recursive: true, mode: 0o700 });
	symlinkSync(join(target, "bobs-factory"), link);
	writeFileSync(
		`${record}.tmp`,
		JSON.stringify({ schema: 1, home, executable: link, initial: identity }),
		{ mode: 0o600 },
	);
	renameSync(`${record}.tmp`, record);
	return link;
}

import { readdirSync as awaitNames } from "node:fs";
