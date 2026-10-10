import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AgentRunnerConfig,
	executionScope,
	type RunnerType,
} from "bobs-factory-core";
import { afterEach, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import {
	checkOperatorTransport,
	inspectOperatorTransport,
	type OperatorTransport,
} from "../src/factory/OperatorTransport.js";
import type { FactoryRun } from "../src/factory/WorkflowRuntime.js";

const { nativeCall, directCall, nativeList, directList } = vi.hoisted(() => ({
	nativeCall: vi.fn(),
	nativeList: vi.fn(),
	directCall: vi.fn(),
	directList: vi.fn(),
}));
vi.mock("bobs-factory-codex-runner", async (original) => ({
	...(await original<object>()),
	callCodexMcpTool: nativeCall,
	listCodexMcpTools: nativeList,
}));
vi.mock("bobs-factory-mcp-tools", async (original) => ({
	...(await original<object>()),
	callConfiguredTool: directCall,
	listConfiguredTools: directList,
}));

const homes: string[] = [];
afterEach(() => {
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

function fixture(runner: RunnerType, acceptedRunner?: RunnerType) {
	const home = mkdtempSync(join(tmpdir(), "factory-oauth-"));
	homes.push(home);
	const worker = new EdgeWorker({
		platform: "cli",
		factoryHome: home,
		repositories: [
			{
				id: "repo",
				name: "Fixture",
				repositoryPath: home,
				workspaceBaseDir: home,
				baseBranch: "main",
				isActive: true,
				linearWorkspaceId: "cli-workspace",
			},
		],
	});
	const edge = worker as unknown as {
		getFactoryRuntime(): { create(input: Partial<FactoryRun>): FactoryRun };
		agentSessionManager: { createChatSession(...args: unknown[]): unknown };
		buildAgentRunnerConfig(): Promise<{
			runnerType: RunnerType;
			config: AgentRunnerConfig;
		}>;
		factoryMcpConfig(run: FactoryRun): Promise<OperatorTransport>;
		factoryTicketAdapter(
			run: FactoryRun,
		): Promise<{ read(): Promise<unknown> }>;
	};
	const run = edge.getFactoryRuntime().create({
		triggerOrigin: {
			type: "manual",
			workflowId: "factory",
			at: new Date().toISOString(),
		},
		repositoryId: "repo",
		workflow: defaultWorkflows.find((w) => w.id === "factory")!,
		workspace: home,
		input: "https://taskbot.example/p/fixture/t/77",
		runner: acceptedRunner,
	});
	run.ticketReference = {
		provider: "taskbot",
		server: "taskbot",
		instance: "https://taskbot.example",
		project: "fixture",
		id: 77,
		url: run.input,
	};
	edge.agentSessionManager.createChatSession(
		run.id,
		{ path: home, isGitWorktree: false },
		"manual",
		[],
	);
	const config: AgentRunnerConfig = {
		factoryHome: home,
		workingDirectory: home,
		allowedTools: ["mcp__taskbot__get_ticket"],
		mcpConfig: {
			taskbot: { type: "http", url: "https://taskbot.example/mcp" },
		},
	};
	vi.spyOn(edge, "buildAgentRunnerConfig").mockResolvedValue({
		runnerType: runner,
		config,
	});
	return { edge, run, config };
}

it.each([
	"claude",
	"codex",
] as const)("keeps the admitted %s check cancellation signal through transport execution", async (runner) => {
	const f = fixture(runner);
	const resolved = await f.edge.factoryMcpConfig(f.run);
	const controller = new AbortController();
	const used = runner === "codex" ? nativeList : directList;
	await checkOperatorTransport(f.run, resolved, "taskbot", controller.signal);
	expect(used).toHaveBeenCalledOnce();
	expect(used.mock.calls[0]).toContain(controller.signal);
	used.mockClear();
	controller.abort(new Error("check expired during preparation"));
	await expect(
		checkOperatorTransport(f.run, resolved, "taskbot", controller.signal),
	).rejects.toThrow("check expired during preparation");
	expect(used).not.toHaveBeenCalled();
});

it.each([
	["codex", undefined],
	["claude", "codex"],
] as const)("uses native OAuth for %s defaults and %s accepted runs", async (runner, acceptedRunner) => {
	const { edge, run } = fixture(runner, acceptedRunner);
	const ticket = {
		id: 77,
		project: "fixture",
		status: "in_progress",
		comments: [],
		attachments: [],
	};
	nativeCall.mockResolvedValue(ticket);
	directCall.mockRejectedValue(new Error("401 Unauthorized"));
	expect(await (await edge.factoryTicketAdapter(run)).read()).toEqual({
		...ticket,
		url: run.input,
	});
	expect(nativeCall).toHaveBeenCalledWith(
		expect.objectContaining({ workingDirectory: run.workspace }),
		"taskbot",
		{ type: "http", url: "https://taskbot.example/mcp" },
		"get_ticket",
		{ project: "fixture", id: 77 },
		expect.any(AbortSignal),
	);
	expect(directCall).not.toHaveBeenCalled();
});

it("retains direct transport for other runners", async () => {
	const { edge, run } = fixture("claude");
	directCall.mockResolvedValue({
		id: 77,
		status: "backlog",
		comments: [],
		attachments: [],
	});
	await (await edge.factoryTicketAdapter(run)).read();
	expect(directCall).toHaveBeenCalledOnce();
	expect(nativeCall).not.toHaveBeenCalled();
});

it("checks configured tool restrictions before native OAuth calls", async () => {
	const { edge, run, config } = fixture("codex");
	config.disallowedTools = ["mcp__taskbot__get_ticket"];
	await expect((await edge.factoryTicketAdapter(run)).read()).rejects.toThrow(
		"restricted by configured tool permissions",
	);
	expect(nativeCall).not.toHaveBeenCalled();
	expect(directCall).not.toHaveBeenCalled();
});

it.each([
	undefined,
	{ HOME: "/selected/home", SELECTED_ACCOUNT: "fixture" },
])("keeps intensive stdio tool descendants attached to their execution lease with child environment %j", async (childEnvironment) => {
	const { edge, run, config } = fixture("codex");
	config.childEnvironment = childEnvironment;
	config.mcpConfig = {
		taskbot: { command: "fixture-tool", env: { CONFIGURED: "retained" } },
	};
	directCall.mockResolvedValue({ ok: true });
	await executionScope.run({ token: "capacity-test-lease" }, async () => {
		const { callTool } = await edge.factoryMcpConfig(run);
		await callTool("taskbot", "get_ticket", {}, new AbortController().signal);
	});
	expect(directCall).toHaveBeenCalledWith(
		expect.objectContaining({
			env: {
				CONFIGURED: "retained",
				BOBS_FACTORY_EXECUTION_LEASE: "capacity-test-lease",
			},
		}),
		"get_ticket",
		{},
		expect.any(AbortSignal),
		run.workspace,
		childEnvironment,
	);
	expect(nativeCall).not.toHaveBeenCalled();
});

it("operator diagnosis and connectivity share native Codex selection while direct authentication rejects", async () => {
	const codex = fixture("claude", "codex");
	nativeCall.mockResolvedValue({
		id: 77,
		status: "in_progress",
		comments: [],
		attachments: [],
	});
	const resolved = await codex.edge.factoryMcpConfig(codex.run);
	expect(inspectOperatorTransport(codex.run, resolved)).toMatchObject({
		runner: "codex",
		connections: [
			{
				server: "taskbot",
				authentication: "codex_native",
				permissionForTicketRead: true,
			},
		],
	});
	expect(await checkOperatorTransport(codex.run, resolved)).toMatchObject({
		connected: true,
		runner: "codex",
		authentication: "codex_native",
	});
	const direct = fixture("opencode");
	directCall.mockRejectedValue(new Error("401 Unauthorized"));
	await expect(
		checkOperatorTransport(
			direct.run,
			await direct.edge.factoryMcpConfig(direct.run),
		),
	).rejects.toThrow("Unauthorized");
	expect(nativeCall).toHaveBeenCalledOnce();
});
it("operator diagnosis distinguishes missing, ambiguous and denied ticket transports", async () => {
	const f = fixture("codex");
	f.config.mcpConfig = {};
	expect(
		inspectOperatorTransport(f.run, await f.edge.factoryMcpConfig(f.run))
			.selection?.error?.code,
	).toBe("missing_transport");
	f.config.mcpConfig = {
		taskbot: { type: "http", url: "https://taskbot.example/mcp" },
		duplicate: { type: "sse", url: "https://taskbot.example/other" },
	};
	expect(
		inspectOperatorTransport(f.run, await f.edge.factoryMcpConfig(f.run))
			.selection?.error?.code,
	).toBe("ambiguous_transport");
	delete f.config.mcpConfig.duplicate;
	f.config.disallowedTools = ["mcp__taskbot__*"];
	const resolved = await f.edge.factoryMcpConfig(f.run);
	expect(
		inspectOperatorTransport(f.run, resolved).connections[0]
			?.permissionForTicketRead,
	).toBe(false);
	await expect(checkOperatorTransport(f.run, resolved)).rejects.toThrow(
		"restricted",
	);
	expect(nativeCall).not.toHaveBeenCalled();
});

it.each([
	"codex",
	"opencode",
] as const)("checks other connections on manual runs with the %s transport", async (runner) => {
	const f = fixture(runner);
	f.run.ticketReference = undefined;
	f.run.input = "ordinary manual request";
	f.config.mcpConfig = {
		other: {
			type: "http",
			url: "https://other.example/mcp",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: configuration credential reference
			headers: { Authorization: "${SELECTED_KEY}" },
		},
	};
	f.config.childEnvironment = { SELECTED_KEY: "fixture-secret" };
	const resolved = await f.edge.factoryMcpConfig(f.run);
	expect(await checkOperatorTransport(f.run, resolved, "other")).toMatchObject({
		connected: true,
		operation: "tools/list",
		server: "other",
		runner,
	});
	const used = runner === "codex" ? nativeList : directList;
	expect(used).toHaveBeenCalledOnce();
	expect(JSON.stringify(used.mock.calls)).toContain("fixture-secret");
	expect(runner === "codex" ? directList : nativeList).not.toHaveBeenCalled();
	expect(nativeCall).not.toHaveBeenCalled();
	expect(directCall).not.toHaveBeenCalled();
	await expect(
		checkOperatorTransport(f.run, resolved, "missing"),
	).rejects.toMatchObject({ code: "missing_transport" });
	used.mockRejectedValueOnce(new Error("401 Unauthorized"));
	await expect(checkOperatorTransport(f.run, resolved)).rejects.toThrow(
		"Unauthorized",
	);
	f.config.mcpConfig.duplicate = {
		type: "http",
		url: "https://duplicate.example/mcp",
	};
	await expect(
		checkOperatorTransport(f.run, await f.edge.factoryMcpConfig(f.run)),
	).rejects.toMatchObject({ code: "ambiguous_transport" });
});
