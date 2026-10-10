import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
	callConfiguredTool,
	listConfiguredTools,
} from "./callConfiguredTool.js";

const server = `
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
const server = new McpServer({name:'fixture',version:'1'});
server.registerTool('echo',{inputSchema:{value:z.string()}},async ({value}) => ({content:[{type:'text',text:value}],structuredContent:{value,cwd:process.cwd(),configured:process.env.FACTORY_MCP_FIXTURE,ambient:process.env.FACTORY_AMBIENT_CANARY}}));
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
it.each([
	"initialization-cancel",
	"catalog-cancel",
	"catalog-timeout",
	"catalog-error",
])("awaits real stdio closure after %s", async (mode) => {
	const home = mkdtempSync(join(tmpdir(), "mcp-close-regression-"));
	const script = `import {createInterface} from 'node:readline';import {writeFileSync} from 'node:fs';
const [home,mode]=process.argv.slice(1);writeFileSync(home+'/pid',String(process.pid));
const input=createInterface({input:process.stdin});
input.on('close',()=>setTimeout(()=>{writeFileSync(home+'/closed','natural');process.exit(0)},200));
input.on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;
if(m.method==='initialize'&&mode!=='initialization-cancel')process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}})+'\\n');
else {writeFileSync(home+'/entered','1');if(mode==='catalog-error')process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-32603,message:'controlled failure'}})+'\\n');}});`;
	const controller = new AbortController();
	const signal =
		mode === "catalog-timeout" ? AbortSignal.timeout(1000) : controller.signal;
	const checking = listConfiguredTools(
		{
			command: process.execPath,
			args: ["--input-type=module", "-e", script, home, mode],
		},
		signal,
		home,
		{ PATH: process.env.PATH ?? "", HOME: home },
	);
	const rejected = expect(checking).rejects.toThrow();
	try {
		await vi.waitFor(() =>
			expect(existsSync(join(home, "entered"))).toBe(true),
		);
		if (mode.endsWith("cancel"))
			controller.abort(new Error("controlled cancellation"));
		await rejected;
		expect(readFileSync(join(home, "closed"), "utf8")).toBe("natural");
		const pid = Number(readFileSync(join(home, "pid"), "utf8"));
		expect(() => process.kill(pid, 0)).toThrow();
	} finally {
		controller.abort();
		await checking.catch(() => {});
		rmSync(home, { recursive: true, force: true });
	}
});

afterEach(() => vi.unstubAllEnvs());
it("passes an explicit complete environment to real MCP grandchildren", async () => {
	vi.stubEnv("FACTORY_AMBIENT_CANARY", "host-secret");
	const result = await callConfiguredTool(
		{
			command: process.execPath,
			args: ["--input-type=module", "-e", server],
			env: { FACTORY_MCP_FIXTURE: "selected" },
		},
		"echo",
		{ value: "private" },
		new AbortController().signal,
		process.cwd(),
		{ PATH: process.env.PATH ?? "", HOME: "/tmp/selected-home" },
	);
	expect(result).toEqual({
		value: "private",
		cwd: process.cwd(),
		configured: "selected",
	});
	expect(process.env.FACTORY_AMBIENT_CANARY).toBe("host-secret");
});
