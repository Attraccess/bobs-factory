import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { normalizeMcpHttpTransport } from "bobs-factory-claude-runner";
import type {
	AgentRunnerConfig,
	ILogger,
	McpServerConfig,
	RunnerType,
} from "bobs-factory-core";

// Not every provider supports a per-server cwd. Launch stdio servers through
// the host runtime so relative commands, arguments and data reads keep the same
// meaning as in the execution worktree, without moving the title agent there.
const stdioLauncher = `const { spawn } = require("node:child_process");
const [cwd, command, ...args] = process.argv.slice(1);
const child = spawn(command, args, { cwd, stdio: "inherit" });
child.on("error", error => { console.error(error.message); process.exit(1); });
child.on("exit", code => process.exit(code ?? 1));
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}`;

/** Preserve source-project MCP discovery and merge order in an isolated job. */
export function titleMcpConfig(
	config: AgentRunnerConfig,
	runner: RunnerType,
	projectDirectory: string,
	logger: ILogger,
): Record<string, McpServerConfig> {
	// Cursor's project MCP source is .cursor/mcp.json, not .mcp.json.
	const projectPath = join(
		projectDirectory,
		...(runner === "cursor" ? [".cursor", "mcp.json"] : [".mcp.json"]),
	);
	const paths = [
		...(existsSync(projectPath) ? [projectPath] : []),
		...(config.mcpConfigPath
			? Array.isArray(config.mcpConfigPath)
				? config.mcpConfigPath
				: [config.mcpConfigPath]
			: []),
	];
	let servers: Record<string, McpServerConfig> = {};
	for (const path of paths) {
		try {
			const parsed = JSON.parse(readFileSync(path, "utf8"));
			if (
				parsed?.mcpServers &&
				typeof parsed.mcpServers === "object" &&
				!Array.isArray(parsed.mcpServers)
			) {
				// Claude's file loader defaults URL-only servers to HTTP; its SDK
				// requires that type inline. Keep other providers' defaults intact
				// (Gemini interprets URL-only entries as SSE).
				if (runner === "claude") normalizeMcpHttpTransport(parsed.mcpServers);
				servers = { ...servers, ...parsed.mcpServers };
			}
		} catch {
			logger.debug(`Skipping unreadable title MCP config at ${path}`);
		}
	}
	servers = { ...servers, ...config.mcpConfig };
	return Object.fromEntries(
		Object.entries(servers).map(([name, server]) => {
			if (!server || !("command" in server) || !server.command)
				return [name, server];
			const { cwd: configuredCwd, ...transport } = server as typeof server & {
				cwd?: string;
			};
			const cwd = resolve(projectDirectory, configuredCwd ?? ".");
			return [
				name,
				{
					...transport,
					command: process.execPath,
					args: process.env.BOBS_FACTORY_INTERNAL_EXECUTABLE
						? ["internal", "stdio", cwd, server.command, ...(server.args ?? [])]
						: [
								"-e",
								stdioLauncher,
								cwd,
								server.command,
								...(server.args ?? []),
							],
				},
			];
		}),
	);
}
