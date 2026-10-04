import { readFileSync, unwatchFile, watchFile } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createFactoryContextServer } from "./factoryContext.js";

const path = process.argv[2];
if (!path) throw new Error("A factory step input snapshot is required");
const server = createFactoryContextServer(
	JSON.parse(readFileSync(path, "utf8")),
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
