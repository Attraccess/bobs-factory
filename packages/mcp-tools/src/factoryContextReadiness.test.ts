import { expect, it } from "vitest";
import {
	FactoryContextInfrastructureError,
	verifyFactoryContext,
} from "./factoryContextReadiness.js";

const config = (mode: string) => ({
	command: process.execPath,
	args: [
		"--input-type=module",
		"-e",
		`
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
const server = new McpServer({name:'factory-context',version:'1'});
server.registerTool('list_context', {}, async () => ({ content:[{type:'text',text:'{}'}], structuredContent:{entries:[],total:0,nextOffset:null} }));
${mode === "missing" ? "" : `server.registerTool('read_context', {}, async () => ({ ${mode === "closed" ? "isError:true," : ""} content:[{type:'text',text:'${mode === "closed" ? "Context snapshot closed" : "{}"}'}], structuredContent:{text:'{}',nextOffset:null} }));`}
await server.connect(new StdioServerTransport());
`,
	],
});
it.each([
	"missing",
	"closed",
])("rejects %s mandatory context infrastructure before model work", async (mode) => {
	await expect(
		verifyFactoryContext(
			config(mode),
			new AbortController().signal,
			process.cwd(),
		),
	).rejects.toBeInstanceOf(FactoryContextInfrastructureError);
});
it("proves fresh scoped list/read tools callable before fresh and resumed turns", async () => {
	await expect(
		verifyFactoryContext(
			config("ready"),
			new AbortController().signal,
			process.cwd(),
		),
	).resolves.toBeUndefined();
});
