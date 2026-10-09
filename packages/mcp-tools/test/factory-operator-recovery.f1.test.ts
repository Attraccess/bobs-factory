import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, expect, it, vi } from "vitest";
import { f1AgentHandlers } from "../../../apps/f1/src/MockAgentRunner.js";
import { EdgeWorker } from "../../edge-worker/src/EdgeWorker.js";
import { defaultWorkflows } from "../../edge-worker/src/factory/defaultWorkflows.js";
import { resolveLaunchRequest } from "../../edge-worker/src/factory/LaunchFields.js";
import { OperatorGrants } from "../../edge-worker/src/factory/OperatorGrants.js";
import { validateWorkflows } from "../../edge-worker/src/factory/Workflow.js";

const { direct, native, discovery } = vi.hoisted(() => ({
	direct: vi.fn(),
	native: vi.fn(),
	discovery: vi.fn(),
}));
vi.mock("bobs-factory-mcp-tools", async (original) => ({
	...(await original<object>()),
	// Mandatory context preflight spawns Node, so use the compiled stdio entry point.
	prepareFactoryContext: (await import("../dist/factoryContext.js"))
		.prepareFactoryContext,
	callConfiguredTool: direct,
	listConfiguredTools: discovery,
}));
vi.mock("bobs-factory-codex-runner", async (original) => ({
	...(await original<object>()),
	callCodexMcpTool: native,
}));
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
	for (const fn of cleanup.splice(0).reverse()) await fn();
	vi.unstubAllEnvs();
	vi.clearAllMocks();
});
it("F1: repairs missing Taskbot transport entirely through compiled stdio MCP, preserving the accepted runner", async () => {
	vi.stubEnv("F1_AGENT_MODE", "mock");
	vi.stubEnv("BOBS_FACTORY_INTERNAL_EXECUTABLE", undefined);
	vi.stubEnv("BOBS_FACTORY_FACTORY_PORT", "0");
	const home = mkdtempSync("/private/tmp/f1-operator-");
	cleanup.push(() => rmSync(home, { recursive: true, force: true }));
	const repo = join(home, "repo");
	execFileSync("git", ["init", "-b", "main", repo]);
	execFileSync("git", [
		"-C",
		repo,
		"-c",
		"user.name=F1",
		"-c",
		"user.email=f1@example.test",
		"commit",
		"--allow-empty",
		"-m",
		"fixture",
	]);
	const remote = join(home, "upstream.git");
	execFileSync("git", ["init", "--bare", remote]);
	execFileSync("git", ["-C", repo, "remote", "add", "origin", remote]);
	execFileSync("git", ["-C", repo, "push", "-u", "origin", "main"]);
	const configPath = join(home, "config.json");
	const config = {
		platform: "cli" as const,
		factoryHome: home,
		defaultRunner: "opencode" as const,
		serverHost: "127.0.0.1",
		serverPort: 0,
		repositories: [
			{
				id: "repo",
				name: "Fixture",
				repositoryPath: repo,
				workspaceBaseDir: join(home, "worktrees"),
				baseBranch: "main",
				isActive: true,
				linearWorkspaceId: "cli-workspace",
			},
		],
	};
	writeFileSync(configPath, JSON.stringify(config));
	const worker = new EdgeWorker({
		...config,
		handlers: f1AgentHandlers(
			"mock",
			JSON.stringify({ status: "completed", summary: "mock role complete" }),
		),
	});
	worker.setConfigPath(configPath);
	cleanup.push(() => worker.stop());
	await worker.start();
	const edge = worker as any,
		runtime = edge.getFactoryRuntime();
	const definitions = validateWorkflows([
		...defaultWorkflows,
		{
			id: "operator-fixture",
			name: "Operator fixture",
			steps: [
				{
					id: "work",
					name: "Work",
					type: "agent",
					prompt: "Do fixture work",
					next: "end",
				},
			],
		},
	]);
	runtime.updateWorkflows(definitions);
	const workflow = definitions.at(-1)!;
	const run = await edge.startManualFactoryRun(
		resolveLaunchRequest(workflow, {
			repositoryId: "repo",
			workflow: workflow.id,
			prompt: "https://taskbot.example/p/fixture/t/77",
			runner: "opencode",
		}),
	);
	await vi.waitFor(() => expect(run.status).toBe("failed"), { timeout: 15000 });
	expect(run.setupComplete).toBe(false);
	const grants = new OperatorGrants(home),
		meta = grants.issue("F1 recovery", ["inspect", "operate", "configure"]);
	const client = new Client({ name: "f1-operator", version: "1" });
	await client.connect(
		new StdioClientTransport({
			command: process.execPath,
			args: [
				resolve("../../apps/cli/dist/src/app.js"),
				"operator-mcp",
				"--home",
				home,
				"--credential-file",
				meta.credentialFile,
			],
			stderr: "pipe",
		}),
	);
	cleanup.push(() => client.close());
	const call = async (name: string, args: Record<string, unknown>) =>
		(await client.callTool({ name, arguments: args })).structuredContent as any;
	const before = (await call("inspect_mcp_connections", { runId: run.id }))
		.result;
	expect(before.runner).toBe("opencode");
	expect(before.selection.error.code).toBe("missing_transport");
	const updated = await call("update_mcp_connection", {
		runId: run.id,
		expectedConfigRevision: before.configRevision,
		server: "taskbot",
		connection: { type: "http", url: "https://taskbot.example/mcp" },
		permissions: ["get_ticket", "set_status", "comment", "add_attachment"],
	});
	expect(updated).toMatchObject({
		ok: true,
		result: { persisted: true, applied: true },
	});
	direct.mockRejectedValueOnce(
		new Error("401 Unauthorized fixture-provider-secret"),
	);
	const rejected = await call("check_mcp_connection", { runId: run.id });
	expect(rejected.error.code).toBe("missing_authentication");
	expect(JSON.stringify(rejected)).not.toContain("fixture-provider-secret");
	direct.mockRejectedValueOnce(new Error("401 Unauthorized"));
	const stillFailed = (await call("inspect_run", { runId: run.id })).result;
	expect(
		(
			await call("retry_run", {
				runId: run.id,
				expectedRevision: stillFailed.revision,
			})
		).error.code,
	).toBe("missing_authentication");
	expect(run.status).toBe("failed");
	direct.mockImplementation(async (_server, tool) =>
		tool === "get_ticket"
			? {
					id: 77,
					project: "fixture",
					title: "Synthetic recovery",
					description: "Fixture only",
					status: "in_progress",
					comments: [],
					attachments: [],
				}
			: { ok: true },
	);
	expect(
		(await call("check_mcp_connection", { runId: run.id })).result.connected,
	).toBe(true);
	const current = (await call("inspect_run", { runId: run.id })).result;
	expect(
		(
			await call("retry_run", {
				runId: run.id,
				expectedRevision: current.revision,
			})
		).ok,
	).toBe(true);
	await vi.waitFor(() => expect(run.setupComplete).toBe(true), {
		timeout: 15000,
	});
	expect(run.runner).toBe("opencode");
	expect(native).not.toHaveBeenCalled();
	await vi.waitFor(() => expect(run.status).toBe("completed"), {
		timeout: 15000,
	});
	expect(run.outputs.work.status).toBe("completed");
	const manual = await edge.startManualFactoryRun(
		resolveLaunchRequest(workflow, {
			repositoryId: "repo",
			workflow: workflow.id,
			prompt: "Ordinary manual work",
			runner: "opencode",
		}),
	);
	await vi.waitFor(() => expect(manual.status).toBe("completed"), {
		timeout: 15000,
	});
	discovery.mockResolvedValue(undefined);
	const probe = await call("check_mcp_connection", {
		runId: manual.id,
		server: "taskbot",
	});
	expect(probe).toMatchObject({
		ok: true,
		result: {
			connected: true,
			operation: "tools/list",
			runner: "opencode",
			server: "taskbot",
		},
	});
	expect(discovery).toHaveBeenCalledWith(
		expect.objectContaining({ url: "https://taskbot.example/mcp" }),
		expect.any(AbortSignal),
		manual.workspace,
		undefined,
	);
	expect(
		(
			await call("check_mcp_connection", {
				runId: manual.id,
				server: "missing",
			})
		).error.code,
	).toBe("missing_transport");
	expect(
		(
			await call("check_mcp_connection", {
				runId: manual.id,
				server: "taskbot",
				tool: "delete_ticket",
			})
		).error.code,
	).toBe("invalid_request");

	expect(
		JSON.parse(readFileSync(configPath, "utf8")).repositories[0].allowedTools,
	).toContain("mcp__taskbot__get_ticket");
}, 60000);
