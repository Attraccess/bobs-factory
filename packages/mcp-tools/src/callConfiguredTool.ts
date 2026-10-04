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
): Promise<unknown> {
	const client = new Client({ name: "cyrus-factory", version: "1.0.0" });
	const transport =
		"command" in config
			? new StdioClientTransport({
					command: config.command,
					args: config.args,
					cwd,
					env: {
						...Object.fromEntries(
							Object.entries(process.env).filter(
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
		const result = await client.callTool({ name, arguments: args }, undefined, {
			signal,
			timeout: 10 * 60 * 1000,
		});
		if (result.isError)
			throw new Error(`MCP tool failed: ${JSON.stringify(result.content)}`);
		return result.structuredContent ?? result;
	} finally {
		signal.removeEventListener("abort", stop);
		await client.close();
	}
}
