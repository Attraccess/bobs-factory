import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";

export interface InstallationProof {
	kind: "desktop" | "installer";
	executable: string;
	record: string;
	sha256: string;
	initialTarget: string;
}
const Identity = z.object({
	product: z.literal("bobs-factory"),
	version: z.string().regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/),
	target: z.enum(["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"]),
	commit: z.string().regex(/^[a-f0-9]{40}$/),
});
function ownedRegular(path: string) {
	const stat = lstatSync(path);
	if (
		!stat.isFile() ||
		stat.isSymbolicLink() ||
		(process.getuid && stat.uid !== process.getuid())
	)
		throw new Error(
			"Installation proof must be an operator-owned regular file",
		);
}
function plainDirectory(path: string) {
	const stat = lstatSync(path);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		(process.getuid && stat.uid !== process.getuid())
	)
		throw new Error(
			"Installation directories must be operator-owned and not linked",
		);
}
export function canonicalExecutableLink(executable: string) {
	return join(realpathSync(dirname(executable)), basename(executable));
}
/** Installation provenance is distinct from permission to launch an executable. */
export function installationProof(
	home: string,
	executable: string,
): InstallationProof | undefined {
	executable = canonicalExecutableLink(executable);
	if (!lstatSync(executable).isSymbolicLink()) return undefined;
	home = realpathSync(home);
	const prefix = dirname(dirname(executable));
	if (executable !== join(prefix, "bin", "bobs-factory")) return undefined;
	const desktop = join(home, "runtime", "desktop-runtime.json");
	let kind: InstallationProof["kind"],
		record: string,
		identity: z.infer<typeof Identity>;
	if (
		prefix === join(home, "runtime", "desktop-installed") &&
		existsSync(desktop)
	) {
		ownedRegular(desktop);
		const value = z
			.object({
				schema: z.literal(1),
				home: z.literal(home),
				executable: z.literal(executable),
				initial: Identity,
			})
			.parse(JSON.parse(readFileSync(desktop, "utf8")));
		kind = "desktop";
		record = desktop;
		identity = value.initial;
	} else {
		const target = realpathSync(executable);
		const build = join(dirname(target), "build.json");
		if (!existsSync(build)) return undefined;
		identity = Identity.parse(JSON.parse(readFileSync(build, "utf8")));
		const name = `bobs-factory-${identity.version}-${identity.target}`;
		if (target !== join(prefix, "lib", "bobs-factory", name, "bobs-factory"))
			return undefined;
		record = join(prefix, "lib", "bobs-factory", "records", `${name}.json`);
		if (!existsSync(record)) return undefined;
		ownedRegular(record);
		z.object({
			schemaVersion: z.literal(1),
			product: z.literal("bobs-factory"),
			owner: z.literal("bobs-factory-installer"),
			version: z.literal(identity.version),
			target: z.literal(identity.target),
			commit: z.literal(identity.commit),
			source: z.enum(["archive", "bootstrap"]),
			channel: z.enum(["manual", "beta", "stable", "nightly"]),
		}).parse(JSON.parse(readFileSync(record, "utf8")));
		plainDirectory(dirname(record));
		kind = "installer";
	}
	for (const path of [
		prefix,
		join(prefix, "bin"),
		join(prefix, "lib"),
		join(prefix, "lib", "bobs-factory"),
	])
		plainDirectory(path);
	return {
		kind,
		executable,
		record,
		sha256: createHash("sha256").update(readFileSync(record)).digest("hex"),
		initialTarget: join(
			prefix,
			"lib",
			"bobs-factory",
			`bobs-factory-${identity.version}-${identity.target}`,
			"bobs-factory",
		),
	};
}
export function assertInstallationProof(
	home: string,
	executable: string,
	proof: InstallationProof | undefined,
) {
	if (!proof || canonicalExecutableLink(executable) !== proof.executable)
		throw new Error(
			"External/package-manager executable has no bound installer ownership; use its manual update handoff",
		);
	if (!lstatSync(executable).isSymbolicLink())
		throw new Error("Owned executable link was replaced");
	ownedRegular(proof.record);
	if (
		createHash("sha256").update(readFileSync(proof.record)).digest("hex") !==
		proof.sha256
	)
		throw new Error(
			"Bound installation ownership changed; replacement forbidden",
		);
	const prefix = dirname(dirname(proof.executable));
	for (const path of [
		prefix,
		join(prefix, "bin"),
		join(prefix, "lib"),
		join(prefix, "lib", "bobs-factory"),
	])
		plainDirectory(path);
	const target = realpathSync(executable);
	if (target === proof.initialTarget) {
		const discovered = installationProof(home, executable);
		if (
			!discovered ||
			discovered.record !== proof.record ||
			discovered.sha256 !== proof.sha256
		)
			throw new Error(
				"Installation proof no longer binds the original runtime",
			);
		return;
	}
	// A later owned switch must be recorded by this home's durable update journal.
	const journal = JSON.parse(
		readFileSync(join(resolve(home), "updates", "state.json"), "utf8"),
	);
	const staged = journal.transaction?.staged;
	if (
		!staged ||
		![staged.executable, staged.previousExecutable].includes(target)
	)
		throw new Error(
			"Runtime link changed outside its owned update transaction",
		);
	const identity = Identity.parse(
		JSON.parse(readFileSync(join(dirname(target), "build.json"), "utf8")),
	);
	const retained = [journal.installed];
	if (
		journal.transaction.switchStarted &&
		[
			"activating",
			"starting",
			"health",
			"rollback",
			"recovery-required",
		].includes(journal.transaction.phase)
	)
		retained.push(
			target === staged.executable
				? staged.candidate
				: journal.transaction.previous,
		);
	if (
		!retained.some(
			(value) =>
				identity.version === value?.version &&
				identity.commit === value?.commit &&
				identity.target === value?.target,
		)
	)
		throw new Error(
			"Runtime link does not match the retained installed identity",
		);
}
