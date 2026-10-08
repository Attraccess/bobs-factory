import { isPackagedExecutable, preparedExecutable } from "bobs-factory-core";
import type { CodexConfigOverrides, CodexConfigValue } from "../types.js";

/** Use the user's prepared CLI; its launcher owns its own runtime requirements. */
const APP_SERVER_ARGS = ["app-server", "--listen", "stdio://"];
export interface CodexAppServerLaunch {
	command: string;
	args: string[];
}
export function resolveCodexAppServerLaunch(
	override?: string,
	configOverrides: CodexConfigOverrides = {},
): CodexAppServerLaunch {
	return {
		command: isPackagedExecutable
			? preparedExecutable(override || "codex")
			: override || "codex",
		args: [
			...APP_SERVER_ARGS,
			...Object.entries(configOverrides)
				.sort(([a], [b]) => a.localeCompare(b))
				.flatMap(([key, value]) => ["-c", `${key}=${toToml(value)}`]),
		],
	};
}

/** CLI overrides require TOML values; JSON objects are parsed as plain strings. */
function toToml(value: CodexConfigValue): string {
	if (Array.isArray(value)) return `[${value.map(toToml).join(", ")}]`;
	if (value && typeof value === "object")
		return `{${Object.entries(value)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, child]) => `${JSON.stringify(key)} = ${toToml(child)}`)
			.join(", ")}}`;
	return JSON.stringify(value);
}
