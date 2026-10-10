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
async function codexMcpRequest(
	config: Pick<
		AgentRunnerConfig,
		| "workingDirectory"
		| "additionalEnv"
		| "childEnvironment"
		| "codexDisabledMcp"
	> &
		Pick<CodexRunnerConfig, "codexPath" | "codexHome">,
	serverName: string,
	server: McpServerConfig,
	tool: string | undefined,
	args: Record<string, unknown>,
	signal: AbortSignal,
): Promise<unknown> {
	signal.throwIfAborted();
	const servers = buildCodexMcpServersConfig({
		mcpConfig: { [serverName]: server },
		allowedTools: tool ? [`mcp__${serverName}__${tool}`] : undefined,
	});
	if (!servers?.[serverName])
		throw new Error(`MCP server ${serverName} cannot be loaded by Codex`);
	// Required startup waits for catalog initialization before status is inspected.
	if (tool === undefined) servers[serverName]!.required = true;
	const { command, args: launchArgs } = resolveCodexAppServerLaunch(
		config.codexPath,
	);
	const client = new AppServerClient({
		binaryPath: command,
		args: launchArgs,
		...(config.childEnvironment || config.additionalEnv || config.codexHome
			? {
					env: {
						...Object.fromEntries(
							Object.entries(config.childEnvironment ?? process.env).filter(
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
	let closing: Promise<void> | undefined;
	const close = () => (closing ??= client.close());
	const stop = () => {
		void close().catch(() => {});
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
				config: {
					mcp_servers: {
						...Object.fromEntries(
							(config.codexDisabledMcp ?? []).map((name) => [
								name,
								{ enabled: false },
							]),
						),
						...servers,
					},
				},
			},
		);
		if (!thread?.id)
			throw new Error("thread/start did not return an MCP connection id");
		signal.throwIfAborted();
		const status = await client.request<{
			data?: {
				name: string;
				runtimeStatus?: string | null;
				toolsError?: string | null;
			}[];
		}>("mcpServerStatus/list", {
			threadId: thread.id,
			serverName,
			detail: "toolsAndAuthOnly",
		});
		signal.throwIfAborted();
		if (tool === undefined) {
			const entry = status.data?.find((item) => item.name === serverName);
			if (
				!entry ||
				entry.toolsError ||
				(entry.runtimeStatus && entry.runtimeStatus !== "connected")
			)
				throw new Error(
					`MCP discovery failed: ${entry?.toolsError || entry?.runtimeStatus || "missing server"}`,
				);
			return;
		}
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
		await close();
	}
}

export function callCodexMcpTool(
	config: Parameters<typeof codexMcpRequest>[0],
	serverName: string,
	server: McpServerConfig,
	tool: string,
	args: Record<string, unknown>,
	signal: AbortSignal,
) {
	return codexMcpRequest(config, serverName, server, tool, args, signal);
}

/** Discover the selected server through native authentication without a model turn. */
export async function listCodexMcpTools(
	config: Parameters<typeof codexMcpRequest>[0],
	serverName: string,
	server: McpServerConfig,
	signal: AbortSignal,
): Promise<void> {
	await codexMcpRequest(config, serverName, server, undefined, {}, signal);
}
