import { isPackagedExecutable, preparedExecutable } from "bobs-factory-core";

/** Use the user's prepared CLI; its launcher owns its own runtime requirements. */
const APP_SERVER_ARGS = ["app-server", "--listen", "stdio://"];
export interface CodexAppServerLaunch {
	command: string;
	args: string[];
}
export function resolveCodexAppServerLaunch(
	override?: string,
): CodexAppServerLaunch {
	return {
		command: isPackagedExecutable
			? preparedExecutable(override || "codex")
			: override || "codex",
		args: [...APP_SERVER_ARGS],
	};
}
