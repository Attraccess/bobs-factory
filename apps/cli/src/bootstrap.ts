import { homedir } from "node:os";
import { join } from "node:path";
import { resolvePath } from "bobs-factory-core";
import { loadEnvFile } from "./envFile.js";

function flag(argv: string[], name: string): string | undefined {
	const index = argv.indexOf(name);
	return index >= 0
		? argv[index + 1]
		: argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}
/** Resolve once before reading .env. A file cannot change its own selected home. */
export function bootstrap(argv = process.argv.slice(2), env = process.env) {
	const home = resolvePath(
		flag(argv, "--home") ??
			env.BOBS_FACTORY_HOME ??
			join(homedir(), ".bobs-factory"),
	);
	const envFile = resolvePath(flag(argv, "--env-file") ?? join(home, ".env"));
	loadEnvFile(envFile, env);
	return { home, envFile };
}
