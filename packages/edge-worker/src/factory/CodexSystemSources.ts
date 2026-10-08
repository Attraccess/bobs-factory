import { existsSync, readFileSync } from "node:fs";

/** System MCP registrations can be disabled. Other system policies need explicit compatibility work. */
export function codexSystemMcp(path = "/etc/codex/config.toml"): string[] {
	if (!existsSync(path)) return [];
	const names = new Set<string>();
	let inServer = false;
	for (const line of readFileSync(path, "utf8").split("\n")) {
		const text = line.trim();
		if (!text || text.startsWith("#")) continue;
		if (text.startsWith("[")) {
			const match =
				/^\[mcp_servers\.([a-zA-Z0-9_-]+)(?:\.(?:env|http_headers|env_http_headers|tools\.[a-zA-Z0-9_-]+))?\]\s*(?:#.*)?$/.exec(
					text,
				);
			if (!match)
				throw new Error(
					"Codex system configuration contains an unsupported policy/source. Keep its policy intact and use Legacy execution",
				);
			inServer = true;
			names.add(match[1]!);
		} else if (!inServer)
			throw new Error(
				"Codex system configuration contains unsupported global settings; use Legacy execution until compatibility is established",
			);
	}
	return [...names];
}
