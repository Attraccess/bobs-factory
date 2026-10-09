import { existsSync, readFileSync, unwatchFile, watchFile } from "node:fs";
import { dirname, join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createFactoryContextServer } from "./factoryContext.js";

export async function serveFactoryContext(
	path: string | undefined,
): Promise<void> {
	if (!path) throw new Error("A factory step input snapshot is required");
	const artifactConfig = join(dirname(path), "artifacts.json");
	const server = createFactoryContextServer(
		JSON.parse(readFileSync(path, "utf8")),
		existsSync(artifactConfig)
			? JSON.parse(readFileSync(artifactConfig, "utf8"))
			: undefined,
	);
	// Some runners pool their MCP connections after a turn. The snapshot's lifetime
	// is the role's lifetime, so release its server even if the connection stays open.
	server.server.onclose = () => unwatchFile(path);
	watchFile(path, { interval: 500 }, (stat) => {
		if (stat.nlink === 0) {
			unwatchFile(path);
			void server.close().finally(() => process.exit(0));
		}
	});
	await server.connect(new StdioServerTransport());
}
