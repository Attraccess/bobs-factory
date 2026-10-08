import { AsyncLocalStorage } from "node:async_hooks";
import { type SpawnOptions, spawn } from "node:child_process";

/** Propagates a lease identity to local descendants, including reparented commands. */
export const executionScope = new AsyncLocalStorage<{ token: string }>();
export function executionEnvironment(): Record<string, string> {
	const scope = executionScope.getStore();
	return scope ? { BOBS_FACTORY_EXECUTION_LEASE: scope.token } : {};
}
/** Same spawn contract, with capacity provenance confined to the child environment. */
export const spawnExecution: typeof spawn = ((
	command: string,
	args: string[] | SpawnOptions = [],
	options: SpawnOptions = {},
) => {
	if (!Array.isArray(args)) {
		options = args;
		args = [];
	}
	return spawn(command, args, {
		...options,
		env: { ...(options.env ?? process.env), ...executionEnvironment() },
	});
}) as typeof spawn;
