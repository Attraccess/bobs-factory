import { isAbsolute, relative, resolve } from "node:path";
import { canonicalPath } from "./paths.js";

const pathFields = new Set([
	"factoryHome",
	"repositoryPath",
	"workspaceBaseDir",
	"mcpConfigPath",
	"promptTemplatePath",
	"path",
	"historyPath",
	"directory",
	"evidenceDir",
	"worktreePath",
	"cwd",
	"workingDirectory",
	"workspace",
	"repositoriesPath",
	"slackMcpConfigs",
	"linearMcpConfigs",
	"githubMcpConfigs",
]);
const toolFields = new Set([
	"allowedTools",
	"disallowedTools",
	"linearAllowedTools",
	"slackAllowedTools",
	"githubAllowedTools",
	"defaultAllowedTools",
	"defaultDisallowedTools",
	"skillNames",
	"plugins",
]);
/** Only operational fields change; prompts, transcripts and credential values remain byte strings. */
export function transformState(
	value: unknown,
	source: string,
	destination: string,
	field = "",
): unknown {
	if (typeof value === "string") {
		if (pathFields.has(field)) {
			const path =
				value === "~/.cyrus" || value.startsWith("~/.cyrus/")
					? resolve(source, value.slice(9))
					: value;
			if (isAbsolute(path)) {
				const suffix = relative(source, canonicalPath(path));
				if (suffix !== ".." && !suffix.startsWith("../") && !isAbsolute(suffix))
					return resolve(
						destination,
						suffix.replace(
							/^cyrus-skills-plugin(?=\/|$)/,
							"bobs-factory-skills-plugin",
						),
					);
			}
		}
		if (toolFields.has(field))
			return value
				.replace(/^mcp__cyrus-tools__/, "mcp__bobs-factory-tools__")
				.replace(/^cyrus-skills:/, "bobs-factory-skills:");
		if (field === "identity") {
			// Coordinator identities begin with an owned path, followed by the leaf kind.
			// Canonicalize that path so aliases and the nested factory directory relocate.
			const match = /^(.*)(:(?:session|preparation|title|run):.*)$/.exec(value);
			if (match && isAbsolute(match[1]!)) {
				const moved = transformState(match[1], source, destination, "path");
				if (moved !== match[1]) return `${moved}${match[2]}`;
			}
		}
		return value;
	}
	if (Array.isArray(value))
		return value.map((item) =>
			transformState(item, source, destination, field),
		);
	if (!value || typeof value !== "object") return value;
	const object = value as Record<string, unknown>;
	if (
		["history", "messages", "agentSessionEntries", "workflow"].includes(field)
	)
		return value;
	if (
		Object.hasOwn(object, "cyrusHome") &&
		Object.hasOwn(object, "factoryHome") &&
		object.cyrusHome !== object.factoryHome
	)
		throw new Error("Conflicting cyrusHome and factoryHome fields");
	return Object.fromEntries(
		Object.entries(object).map(([key, child]) => {
			const name =
				key === "cyrusHome"
					? "factoryHome"
					: key === "cyrus-tools" && field === "mcpServers"
						? "bobs-factory-tools"
						: key;
			return [name, transformState(child, source, destination, name)];
		}),
	);
}

export function transformEnvironment(
	text: string,
	source?: string,
	destination?: string,
): string {
	const keys = new Set(
		text
			.split(/\r?\n/)
			.map((line) => /^(?:export\s+)?([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
			.filter(Boolean),
	);
	return text.replace(
		/^(export\s+)?(CYRUS_[A-Z0-9_]+)=(.*)$/gm,
		(_match, prefix: string | undefined, key: string, value: string) => {
			const renamed = key.replace(/^CYRUS_/, "BOBS_FACTORY_");
			if (keys.has(renamed))
				throw new Error(`Environment key collision: ${renamed}`);
			const pathKeys = [
				"BOBS_FACTORY_HOME",
				"BOBS_FACTORY_REPOS_DIR",
				"BOBS_FACTORY_WORKTREES_DIR",
				"BOBS_FACTORY_CAPACITY_DIRECTORY",
			];
			if (source && destination && pathKeys.includes(renamed)) {
				const match =
					/^(?:"([^"\n]*)"|'([^'\n]*)'|([^#\s]*))(\s*(?:#.*)?)$/.exec(value);
				if (!match) throw new Error(`Ambiguous environment path: ${renamed}`);
				const path = match[1] ?? match[2] ?? match[3] ?? "";
				const transformed = transformState(path, source, destination, "path");
				const quote =
					match[1] !== undefined ? '"' : match[2] !== undefined ? "'" : "";
				if (
					!quote &&
					typeof transformed === "string" &&
					/[#\s]/.test(transformed)
				)
					throw new Error(`Environment path requires quotes: ${renamed}`);
				value = `${quote}${transformed}${quote}${match[4] ?? ""}`;
			}
			return `${prefix ?? ""}${renamed}=${value}`;
		},
	);
}
