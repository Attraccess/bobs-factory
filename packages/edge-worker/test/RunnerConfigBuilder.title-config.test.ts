import {
	AgentSessionStatus,
	AgentSessionType,
	type RepositoryConfig,
	type RunnerType,
} from "cyrus-core";
import { expect, it, vi } from "vitest";
import { titleSystemPrompt } from "../src/factory/RunTitleGenerator.js";
import { RunnerConfigBuilder } from "../src/RunnerConfigBuilder.js";

it.each([
	"claude",
	"codex",
	"gemini",
	"cursor",
	"opencode",
] as const)("selects %s before building native auxiliary config and preserves authenticated context tools", (runner: RunnerType) => {
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
					path: "/home/factory/title-jobs/root",
					isGitWorktree: false,
				},
			},
			sessionId: "title-root",
			repository,
			systemPrompt: titleSystemPrompt,
			allowedTools: ["mcp__context__lookup_ticket"],
			disallowedTools: ["Write(**)"],
			allowedDirectories: ["/repo", "/worktree"],
			platformMcpConfigOverrides: ["/platform/context.json"],
			linearWorkspaceId: "ws",
			requireLinearWorkspaceId: () => "ws",
			cyrusHome: "/home",
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
	);
	expect(selectors.determineRunnerSelection).not.toHaveBeenCalled();
	expect(config.model).toBe("cheap-title");
	expect(config.workingDirectory).toBe("/home/factory/title-jobs/root");
	expect(config.appendSystemPrompt).toBe(titleSystemPrompt);
	expect(config.mcpConfig).toEqual(mcp.buildMcpConfig.mock.results[0].value);
	expect(config.mcpConfigPath).toBe("/platform/context.json");
	expect(config.allowedTools).toEqual(["mcp__context__lookup_ticket"]);
	expect(config.additionalEnv?.CYRUS_GH_TOKEN).toBe("fixture-token");
	expect(config.hooks).toBeUndefined();
	expect(config.resumeSessionId).toBeUndefined();
	expect(config.onAskUserQuestion).toBeUndefined();
	expect(config.maxTurns).toBe(4);
	if (runner === "codex")
		expect(config.sandboxSettings).toEqual({
			allowWrite: ["/home/factory/title-jobs/root"],
			allowRead: ["/home/factory/title-jobs/root", "/repo", "/worktree"],
		});
	if (runner === "opencode")
		expect(config.opencodeRepositoryConfig).toEqual(
			repository.opencode?.config,
		);
});
