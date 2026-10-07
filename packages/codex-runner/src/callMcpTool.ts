import type { AgentRunnerConfig, McpServerConfig } from "bobs-factory-core";
import { AppServerClient } from "./backend/appServerClient.js";
import { resolveCodexAppServerLaunch } from "./backend/codexBinary.js";
import { buildCodexMcpServersConfig } from "./config/mcpConfigTranslator.js";
import type { CodexRunnerConfig } from "./types.js";

interface McpToolResult {
	content: { type?: string; text?: string }[];
	isError?: boolean | null;
	structuredContent?: unknown;
}

/** Use Codex's MCP transport and OAuth store without starting a model turn. */
export async function callCodexMcpTool(
	config: Pick<AgentRunnerConfig, "workingDirectory" | "additionalEnv"> &
		Pick<CodexRunnerConfig, "codexPath" | "codexHome">,
	serverName: string,
	server: McpServerConfig,
	tool: string,
	args: Record<string, unknown>,
	signal: AbortSignal,
): Promise<unknown> {
	signal.throwIfAborted();
	const servers = buildCodexMcpServersConfig({
		mcpConfig: { [serverName]: server },
		allowedTools: [`mcp__${serverName}__${tool}`],
	});
	if (!servers?.[serverName])
		throw new Error(`MCP server ${serverName} cannot be loaded by Codex`);
	const { command, args: launchArgs } = resolveCodexAppServerLaunch(
		config.codexPath,
	);
	const client = new AppServerClient({
		binaryPath: command,
		args: launchArgs,
		...(config.additionalEnv || config.codexHome
			? {
					env: {
						...Object.fromEntries(
							Object.entries(process.env).filter(
								(entry): entry is [string, string] => entry[1] !== undefined,
							),
						),
						...config.additionalEnv,
						...(config.codexHome ? { CODEX_HOME: config.codexHome } : {}),
					},
				}
			: {}),
	});
	// Pending requests carry process failures back to the caller.
	client.on("error", () => {});
	client.setServerRequestHandler(() => {
		throw new Error(
			`Interactive MCP authorization required; run codex mcp login ${serverName}`,
		);
	});
	const stop = () => {
		void client.close();
	};
	signal.addEventListener("abort", stop, { once: true });
	try {
		client.start();
		await client.request("initialize", {
			clientInfo: { name: "cyrus-factory-mcp", version: "1.0.0" },
			capabilities: { experimentalApi: true },
		});
		signal.throwIfAborted();
		const { thread } = await client.request<{ thread: { id: string } }>(
			"thread/start",
			{
				cwd: config.workingDirectory,
				approvalPolicy: "never",
				sandbox: "read-only",
				ephemeral: true,
				config: { mcp_servers: servers },
			},
		);
		if (!thread?.id)
			throw new Error("thread/start did not return an MCP connection id");
		signal.throwIfAborted();
		await client.request("mcpServerStatus/list", {
			threadId: thread.id,
			serverName,
			detail: "toolsAndAuthOnly",
		});
		signal.throwIfAborted();
		const result = await client.request<McpToolResult>("mcpServer/tool/call", {
			threadId: thread.id,
			server: serverName,
			tool,
			arguments: args,
		});
		signal.throwIfAborted();
		if (result.isError) {
			const message = result.content
				.filter((block) => block.type === "text")
				.map((block) => block.text?.trim())
				.filter(Boolean)
				.join("\n");
			throw new Error(
				`MCP tool failed: ${message || "Provider returned an error without a text message."}`,
			);
		}
		return result.structuredContent ?? result;
	} catch (error) {
		signal.throwIfAborted();
		throw error;
	} finally {
		signal.removeEventListener("abort", stop);
		await client.close();
	}
}
