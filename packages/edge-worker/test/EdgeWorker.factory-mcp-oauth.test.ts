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
import type { FactoryRun } from "../src/factory/WorkflowRuntime.js";

const { nativeCall, directCall } = vi.hoisted(() => ({
	nativeCall: vi.fn(),
	directCall: vi.fn(),
}));
vi.mock("bobs-factory-codex-runner", async (original) => ({
	...(await original<object>()),
	callCodexMcpTool: nativeCall,
}));
vi.mock("bobs-factory-mcp-tools", async (original) => ({
	...(await original<object>()),
	callConfiguredTool: directCall,
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
		factoryMcpConfig(run: FactoryRun): Promise<{
			callTool(
				server: string,
				tool: string,
				args: Record<string, unknown>,
				signal: AbortSignal,
			): Promise<unknown>;
		}>;
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
