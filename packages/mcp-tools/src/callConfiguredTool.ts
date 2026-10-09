import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export type ToolServerConfig =
	| {
			type?: "stdio";
			command: string;
			args?: string[];
			env?: Record<string, string>;
	  }
	| { type: "http" | "sse"; url: string; headers?: Record<string, string> };

/** Invoke one configured MCP tool without launching an agent. */
export async function callConfiguredTool(
	config: ToolServerConfig,
	name: string,
	args: Record<string, unknown>,
	signal: AbortSignal,
	cwd: string,
	childEnvironment?: Record<string, string>,
): Promise<unknown> {
	return withConfiguredClient(
		config,
		signal,
		cwd,
		childEnvironment,
		async (client) => {
			const result = await client.callTool(
				{ name, arguments: args },
				undefined,
				{
					signal,
					timeout: 10 * 60 * 1000,
				},
			);
			if (result.isError) {
				const message = Array.isArray(result.content)
					? result.content
							.filter((block) => block.type === "text")
							.map((block) =>
								typeof block.text === "string" ? block.text.trim() : "",
							)
							.filter(Boolean)
							.join("\n")
					: "";
				throw new Error(
					`MCP tool failed: ${message || "Provider returned an error without a text message."}`,
				);
			}
			return result.structuredContent ?? result;
		},
	);
}

/** Read only the first catalog page; no provider tools are invoked. */
export async function listConfiguredTools(
	config: ToolServerConfig,
	signal: AbortSignal,
	cwd: string,
	childEnvironment?: Record<string, string>,
): Promise<void> {
	await withConfiguredClient(
		config,
		signal,
		cwd,
		childEnvironment,
		async (client) => {
			await client.listTools({}, { signal });
		},
	);
}

async function withConfiguredClient<T>(
	config: ToolServerConfig,
	signal: AbortSignal,
	cwd: string,
	childEnvironment: Record<string, string> | undefined,
	operation: (client: Client) => Promise<T>,
): Promise<T> {
	const client = new Client({ name: "cyrus-factory", version: "1.0.0" });
	const transport =
		"command" in config
			? new StdioClientTransport({
					command: config.command,
					args: config.args,
					cwd,
					env: {
						...Object.fromEntries(
							Object.entries(childEnvironment ?? process.env).filter(
								(entry): entry is [string, string] => entry[1] !== undefined,
							),
						),
						...config.env,
					},
				})
			: config.type === "sse"
				? new SSEClientTransport(new URL(config.url), {
						requestInit: { headers: config.headers },
					})
				: new StreamableHTTPClientTransport(new URL(config.url), {
						requestInit: { headers: config.headers },
					});
	const stop = () => {
		void client.close();
	};
	signal.addEventListener("abort", stop, { once: true });
	try {
		signal.throwIfAborted();
		await client.connect(transport);
		signal.throwIfAborted();
		return await operation(client);
	} finally {
		signal.removeEventListener("abort", stop);
		await client.close();
	}
}
