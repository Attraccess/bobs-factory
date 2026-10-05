import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AgentSessionStatus,
	AgentSessionType,
	type RepositoryConfig,
	type RunnerType,
} from "cyrus-core";
import { afterEach, expect, it, vi } from "vitest";
import { titleSystemPrompt } from "../src/factory/RunTitleGenerator.js";
import { RunnerConfigBuilder } from "../src/RunnerConfigBuilder.js";

const projects: string[] = [];
afterEach(() => {
	for (const project of projects.splice(0))
		rmSync(project, { recursive: true, force: true });
});

it.each([
	"claude",
	"codex",
	"gemini",
	"cursor",
	"opencode",
] as const)("selects %s before building native auxiliary config and preserves authenticated context tools", (runner: RunnerType) => {
	const project = mkdtempSync(join(tmpdir(), "title-project-mcp-"));
	projects.push(project);
	const auxiliary = join(project, "title-job");
	mkdirSync(auxiliary);
	mkdirSync(join(project, ".cursor"));
	const projectConfig = join(
		project,
		runner === "cursor" ? ".cursor/mcp.json" : ".mcp.json",
	);
	const override = join(project, "override.json");
	writeFileSync(
		override,
		JSON.stringify({
			mcpServers: {
				ticket: { type: "http", url: "https://override.example/mcp" },
				context: {
					type: "http",
					url: "https://overridden-by-inline.example/mcp",
				},
			},
		}),
	);
	writeFileSync(
		join(project, "ticket.cjs"),
		`process.stdout.write(JSON.stringify({cwd:process.cwd(), data:require("node:fs").readFileSync(process.argv[2],"utf8"), token:process.env.TICKET_TOKEN}));`,
	);
	writeFileSync(join(project, "ticket-data.txt"), "Inventory resets");
	writeFileSync(
		projectConfig,
		JSON.stringify({
			mcpServers: {
				ticket: { type: "http", url: "https://tickets.example/mcp" },
				local: {
					command: process.execPath,
					args: ["ticket.cjs", "ticket-data.txt"],
					env: { TICKET_TOKEN: "fixture" },
				},
			},
		}),
	);
	const originalProjectConfig = readFileSync(projectConfig, "utf8");
	const selectors = {
		getDefaultRunner: () => "claude" as const,
		getDefaultModelForRunner: (provider: RunnerType) => `${provider}-default`,
		getDefaultFallbackModelForRunner: () => "fallback",
		determineRunnerSelection: vi.fn(() => ({
			runnerType: "claude" as const,
			modelOverride: "expensive-execution",
		})),
	};
	const mcp = {
		buildMcpConfig: vi.fn(() => ({
			context: {
				type: "http" as const,
				url: "https://context.example/mcp",
				headers: { Authorization: "Bearer fixture" },
			},
		})),
		buildMergedMcpConfigPath: () => "/repo/context.json",
	};
	const builder = new RunnerConfigBuilder(
		{ buildChatAllowedTools: () => [] },
		mcp,
		selectors,
	);
	const repository: RepositoryConfig = {
		id: "repo",
		name: "Repo",
		repositoryPath: "/repo",
		workspaceBaseDir: "/worktrees",
		isActive: true,
		baseBranch: "main",
		model: "expensive-repo",
		opencode: { config: { provider: {} }, stateScope: "repo" },
	};
	const config = builder.buildTitleConfig(
		{
			session: {
				id: "title-root",
				type: AgentSessionType.CommentThread,
				context: AgentSessionType.CommentThread,
				status: AgentSessionStatus.Active,
				createdAt: 1,
				updatedAt: 1,
				repositories: [],
				workspace: {
					path: auxiliary,
					isGitWorktree: false,
				},
			},
			sessionId: "title-root",
			repository,
			systemPrompt: titleSystemPrompt,
			allowedTools: ["mcp__context__lookup_ticket"],
			disallowedTools: ["Write(**)"],
			allowedDirectories: ["/repo", "/worktree"],
			platformMcpConfigOverrides: [override],
			linearWorkspaceId: "ws",
			requireLinearWorkspaceId: () => "ws",
			cyrusHome: project,
			logger: {
				debug: () => {},
				info: () => {},
				warn: () => {},
				error: () => {},
			} as never,
			onMessage: () => {},
			onError: () => {},
			sandboxSettings: { enabled: true },
			githubToken: "fixture-token",
			labels: ["claude/expensive"],
			issueDescription: "[agent=opencode]",
			createAskUserQuestionCallback: vi.fn(),
		},
		{
			runner,
			model: "cheap-title",
			...(runner === "codex" ? { modelReasoningEffort: "low" as const } : {}),
		},
		project,
	);
	expect(selectors.determineRunnerSelection).not.toHaveBeenCalled();
	expect(config.model).toBe("cheap-title");
	expect(config.workingDirectory).toBe(auxiliary);
	expect(config.appendSystemPrompt).toBe(titleSystemPrompt);
	expect(config.mcpConfig).toMatchObject({
		ticket: { type: "http", url: "https://override.example/mcp" },
		context: mcp.buildMcpConfig.mock.results[0].value.context,
	});
	expect(config.mcpConfigPath).toBeUndefined();
	const local = config.mcpConfig!.local as {
		command: string;
		args: string[];
		env: Record<string, string>;
	};
	const result = spawnSync(local.command, local.args, {
		cwd: auxiliary,
		env: { ...process.env, ...local.env },
		encoding: "utf8",
	});
	expect(result.status, result.stderr).toBe(0);
	expect(JSON.parse(result.stdout)).toEqual({
		cwd: realpathSync(project),
		data: "Inventory resets",
		token: "fixture",
	});
	expect(readFileSync(projectConfig, "utf8")).toBe(originalProjectConfig);
	expect(config.allowedTools).toEqual(["mcp__context__lookup_ticket"]);
	expect(config.additionalEnv?.CYRUS_GH_TOKEN).toBe("fixture-token");
	expect(config.hooks).toBeUndefined();
	expect(config.resumeSessionId).toBeUndefined();
	expect(config.onAskUserQuestion).toBeUndefined();
	expect(config.maxTurns).toBe(4);
	if (runner === "codex")
		expect(config.sandboxSettings).toEqual({
			allowWrite: [auxiliary],
			allowRead: [auxiliary, "/repo", "/worktree"],
		});
	if (runner === "opencode")
		expect(config.opencodeRepositoryConfig).toEqual(
			repository.opencode?.config,
		);
});
