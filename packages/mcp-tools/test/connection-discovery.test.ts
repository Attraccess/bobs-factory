import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { listConfiguredTools } from "../src/callConfiguredTool.js";

it("discovers a real stdio connection without calling any provider tool", async () => {
	const root = mkdtempSync(join(tmpdir(), "mcp-discovery-"));
	try {
		const fixture = join(root, "server.mjs");
		writeFileSync(
			fixture,
			`
import { Server } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/index.js"))};
import { StdioServerTransport } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/stdio.js"))};
import { ListToolsRequestSchema, CallToolRequestSchema } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/types.js"))};
const server = new Server({ name: "fixture", version: "1" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
server.setRequestHandler(CallToolRequestSchema, async () => { throw new Error("Provider tools must not be invoked"); });
await server.connect(new StdioServerTransport());
`,
		);
		await expect(
			listConfiguredTools(
				{ command: process.execPath, args: [fixture] },
				AbortSignal.timeout(5000),
				root,
			),
		).resolves.toBeUndefined();
		await expect(
			listConfiguredTools(
				{ command: process.execPath, args: [fixture] },
				AbortSignal.abort(),
				root,
			),
		).rejects.toThrow();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
