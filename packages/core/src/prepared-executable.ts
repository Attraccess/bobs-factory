import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";
/** Resolve the user's installed CLI, without changing installation or authentication. */
export function preparedExecutable(command: string): string {
	const candidates =
		isAbsolute(command) || command.includes("/")
			? [resolve(command)]
			: (process.env.PATH ?? "")
					.split(delimiter)
					.filter(Boolean)
					.map((directory) => join(directory, command));
	for (const path of candidates) {
		try {
			accessSync(path, constants.X_OK);
			if (statSync(path).isFile()) return path;
		} catch {
			/* try next PATH entry */
		}
	}
	throw new Error(
		`Missing prepared agent tool '${command}'. Install and authenticate its CLI for this service account, then put it on PATH or configure its executable path. Bob’s Factory does not install or authenticate agent tools.`,
	);
}
