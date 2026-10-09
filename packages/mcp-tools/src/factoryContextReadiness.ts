import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ToolServerConfig } from "./callConfiguredTool.js";
export class FactoryContextInfrastructureError extends Error {
	constructor(
		message: string,
		public output?: unknown,
	) {
		super(message);
	}
}
/** One connection, two bounded probes; no model/provider credits or full-context download. */
export async function verifyFactoryContext(
	config: ToolServerConfig,
	signal: AbortSignal,
	cwd: string,
): Promise<void> {
	if (!("command" in config))
		throw new FactoryContextInfrastructureError(
			"Factory context must use its scoped stdio connection",
		);
	const client = new Client({
		name: "factory-context-preflight",
		version: "1",
	});
	const transport = new StdioClientTransport({
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
	});
	const stop = () => {
		void client.close();
	};
	signal.addEventListener("abort", stop, { once: true });
	const timeout = setTimeout(stop, 15000);
	try {
		signal.throwIfAborted();
		await client.connect(transport);
		for (const name of ["list_context", "read_context"]) {
			const result = await client.callTool(
				{ name, arguments: { path: "", limit: 1 } },
				undefined,
				{ timeout: 10000, signal },
			);
			if (result.isError) throw new Error(`${name} unavailable`);
		}
	} catch (error) {
		if (signal.aborted) throw error;
		throw new FactoryContextInfrastructureError(
			`Mandatory factory-context list/read tools are unavailable: ${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		clearTimeout(timeout);
		signal.removeEventListener("abort", stop);
		await client.close();
	}
}
