import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { callCodexMcpTool } from "../src/callMcpTool.js";

const { client, launch } = vi.hoisted(() => ({
	client: {
		start: vi.fn(),
		request: vi.fn(),
		close: vi.fn(),
		on: vi.fn(),
		setServerRequestHandler: vi.fn(),
	},
	launch: vi.fn(),
}));
vi.mock("../src/backend/appServerClient.js", () => ({
	AppServerClient: class {
		start = client.start;
		request = client.request;
		close = client.close;
		on = client.on;
		setServerRequestHandler = client.setServerRequestHandler;
		constructor(options: unknown) {
			launch(options);
		}
	},
}));
vi.mock("../src/backend/codexBinary.js", () => ({
	resolveCodexAppServerLaunch: () => ({
		command: "/fixture/codex",
		args: ["app-server"],
	}),
}));

const config = {
	workingDirectory: "/fixture/worktree",
	codexHome: "/fixture/codex-home",
	additionalEnv: { FIXTURE: "yes" },
};
const server = {
	type: "http" as const,
	url: "https://taskbot.example/mcp",
	headers: { "X-Fixture": "yes" },
};
beforeEach(() => {
	client.close.mockResolvedValue(undefined);
	client.request.mockImplementation(async (method: string) => {
		if (method === "thread/start") return { thread: { id: "mcp-thread" } };
		if (method === "mcpServer/tool/call")
			return { content: [], structuredContent: { id: 77 } };
		return {};
	});
});
afterEach(() => vi.resetAllMocks());

it("uses the native MCP connection without a model turn or a saved conversation", async () => {
	expect(
		await callCodexMcpTool(
			config,
			"taskbot",
			server,
			"get_ticket",
			{ id: 77 },
			new AbortController().signal,
		),
	).toEqual({ id: 77 });
	expect(launch).toHaveBeenCalledWith(
		expect.objectContaining({
			env: expect.objectContaining({
				CODEX_HOME: config.codexHome,
				FIXTURE: "yes",
			}),
		}),
	);
	expect(client.request.mock.calls).toEqual([
		[
			"initialize",
			{
				clientInfo: { name: "cyrus-factory-mcp", version: "1.0.0" },
				capabilities: { experimentalApi: true },
			},
		],
		[
			"thread/start",
			{
				cwd: config.workingDirectory,
				approvalPolicy: "never",
				sandbox: "read-only",
				ephemeral: true,
				config: {
					mcp_servers: {
						taskbot: {
							url: server.url,
							http_headers: server.headers,
							enabled_tools: ["get_ticket"],
							default_tools_approval_mode: "approve",
						},
					},
				},
			},
		],
		[
			"mcpServerStatus/list",
			{
				threadId: "mcp-thread",
				serverName: "taskbot",
				detail: "toolsAndAuthOnly",
			},
		],
		[
			"mcpServer/tool/call",
			{
				threadId: "mcp-thread",
				server: "taskbot",
				tool: "get_ticket",
				arguments: { id: 77 },
			},
		],
	]);
	expect(client.close).toHaveBeenCalledOnce();
});

it("propagates provider failures and closes the native connection", async () => {
	client.request.mockImplementation(async (method: string) => {
		if (method === "thread/start") return { thread: { id: "mcp-thread" } };
		if (method === "mcpServer/tool/call")
			return {
				isError: true,
				content: [{ type: "text", text: " status conflict " }],
			};
		return {};
	});
	await expect(
		callCodexMcpTool(
			config,
			"taskbot",
			server,
			"set_status",
			{},
			new AbortController().signal,
		),
	).rejects.toThrow("MCP tool failed: status conflict");
	expect(client.close).toHaveBeenCalledOnce();
});

it("does not start a connection for an already canceled call", async () => {
	await expect(
		callCodexMcpTool(
			config,
			"taskbot",
			server,
			"get_ticket",
			{},
			AbortSignal.abort(),
		),
	).rejects.toThrow();
	expect(launch).not.toHaveBeenCalled();
});

it("cancellation during startup prevents the ticket mutation and closes the connection", async () => {
	const controller = new AbortController();
	client.request.mockImplementation(async (method: string) => {
		if (method === "thread/start") return { thread: { id: "mcp-thread" } };
		if (method === "mcpServerStatus/list")
			controller.abort(new Error("run stopped"));
		return {};
	});
	await expect(
		callCodexMcpTool(
			config,
			"taskbot",
			server,
			"set_status",
			{},
			controller.signal,
		),
	).rejects.toThrow("run stopped");
	expect(client.request.mock.calls.map(([method]) => method)).toEqual([
		"initialize",
		"thread/start",
		"mcpServerStatus/list",
	]);
	expect(client.close).toHaveBeenCalled();
});
