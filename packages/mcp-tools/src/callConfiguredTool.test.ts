import { expect, it } from "vitest";
import { callConfiguredTool } from "./callConfiguredTool.js";

const server = `
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
const server = new McpServer({name:'fixture',version:'1'});
server.registerTool('echo',{inputSchema:{value:z.string()}},async ({value}) => ({content:[{type:'text',text:value}],structuredContent:{value,cwd:process.cwd(),configured:process.env.FACTORY_MCP_FIXTURE}}));
server.registerTool('fail',{},async () => ({isError:true,content:[{type:'text',text:'fixture failure'}]}));
await server.connect(new StdioServerTransport());
`;

it("calls a real stdio MCP tool with its arguments, environment and worktree", async () => {
	const config = {
		command: process.execPath,
		args: ["--input-type=module", "-e", server],
		env: { FACTORY_MCP_FIXTURE: "yes" },
	};
	const signal = new AbortController().signal;
	expect(
		await callConfiguredTool(
			config,
			"echo",
			{ value: "plan" },
			signal,
			process.cwd(),
		),
	).toEqual({ value: "plan", cwd: process.cwd(), configured: "yes" });
	await expect(
		callConfiguredTool(config, "fail", {}, signal, process.cwd()),
	).rejects.toThrow("fixture failure");
});

it("does not spawn a configured tool after termination", async () => {
	const controller = new AbortController();
	controller.abort(new Error("Run terminated"));
	await expect(
		callConfiguredTool(
			{ command: "nonexistent-command" },
			"echo",
			{},
			controller.signal,
			process.cwd(),
		),
	).rejects.toThrow("Run terminated");
});
