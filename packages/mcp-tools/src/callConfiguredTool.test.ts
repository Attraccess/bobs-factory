import { expect, it } from "vitest";
import { callConfiguredTool } from "./callConfiguredTool.js";

const server = `
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
const server = new McpServer({name:'fixture',version:'1'});
server.registerTool('echo',{inputSchema:{value:z.string()}},async ({value}) => ({content:[{type:'text',text:value}],structuredContent:{value,cwd:process.cwd(),configured:process.env.FACTORY_MCP_FIXTURE}}));
server.registerTool('fail',{},async () => ({isError:true,content:[{type:'text',text:'fixture failure'}]}));
server.registerTool('mixed_failure',{},async () => ({isError:true,content:[{type:'text',text:' Taskbot provider unavailable '},{type:'image',data:'AA==',mimeType:'image/png'},{type:'text',text:' '},{type:'text',text:'Try again later.'}]}));
server.registerTool('nontext_failure',{},async () => ({isError:true,content:[{type:'image',data:'AA==',mimeType:'image/png'}]}));
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
	).rejects.toThrow(new Error("MCP tool failed: fixture failure"));
});

it.each([
	[
		"mixed_failure",
		"MCP tool failed: Taskbot provider unavailable\nTry again later.",
	],
	[
		"nontext_failure",
		"MCP tool failed: Provider returned an error without a text message.",
	],
])("reports readable provider errors for %s", async (name, message) => {
	await expect(
		callConfiguredTool(
			{
				command: process.execPath,
				args: ["--input-type=module", "-e", server],
			},
			name,
			{},
			new AbortController().signal,
			process.cwd(),
		),
	).rejects.toThrow(new Error(message));
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
