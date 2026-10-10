import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSessionStatus } from "bobs-factory-core";
import { expect, it } from "vitest";
import { ChatSessionHandler } from "../src/ChatSessionHandler.js";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { RunnerConfigBuilder } from "../src/RunnerConfigBuilder.js";
import { RunnerSelectionService } from "../src/RunnerSelectionService.js";

it.each([
	"slack",
	"zulip",
] as const)("persists and resumes the accepted %s model through production runner wiring", async (platform) => {
	const home = mkdtempSync(join(tmpdir(), "chat-model-recovery-"));
	try {
		const config: any = {
			defaultRunner: "codex",
			codexDefaultModel: "accepted-chat-model",
		};
		const selector = new RunnerSelectionService(config);
		const provider = {
			getDefaultRepository: () => undefined,
			getDefaultLinearWorkspaceId: () => undefined,
			getRepositoryPaths: () => [],
		};
		const builder = new RunnerConfigBuilder(
			{ buildChatAllowedTools: () => [] },
			{
				buildMcpConfig: () => ({}),
				buildMergedMcpConfigPath: () => undefined,
			},
			selector,
		);
		const observed: any[] = [];
		const prompts: string[] = [];
		// Keep the production handler, selector, builder and chat factory.
		// Only provider execution and unrelated host side effects are simulated.
		const worker: any = Object.assign(Object.create(EdgeWorker.prototype), {
			factoryHome: home,
			config,
			runnerSelectionService: selector,
			runnerConfigBuilder: builder,
			requireSessionWorkflowAvailable: () => {},
			emit: () => {},
			prepareRunTitle: () => {},
			startRunTitle: () => {},
			skillsPluginResolver: {
				resolve: async () => [],
				discoverSkillNames: async () => [],
			},
			savePersistedState: async () => {},
			handleClaudeError: (error: unknown) => {
				throw error;
			},
			activeWebhookCount: 0,
			createRunnerForType: (runner: string, runnerConfig: any) => {
				observed.push({ runner, ...runnerConfig });
				return {
					start: async (prompt: string) => {
						prompts.push(prompt);
						return { sessionId: "retained-thread" };
					},
					isRunning: () => false,
					supportsStreamingInput: false,
					getMessages: () => [],
					stop: () => {},
				};
			},
		});
		const deps = worker.buildChatSessionHandlerDeps(provider, () => undefined);
		const adapter: any = {
			platformName: platform,
			extractTaskInstructions: (event: any) => event.text,
			getThreadKey: () => "channel:thread",
			getEventId: (event: any) => event.id,
			buildSystemPrompt: () => "Chat instructions",
			fetchThreadContext: async () => "",
			postReply: async () => {},
			acknowledgeReceipt: async () => {},
			notifyBusy: async () => {},
		};
		let handler = new ChatSessionHandler(adapter, deps);
		await handler.handleEvent({ id: "initial", text: "Initial task" });
		const session = handler.getAllChatSessions()[0]!;
		expect(session.metadata?.pendingExecution?.model).toBe(
			"accepted-chat-model",
		);
		expect(observed[0].model).toBe("accepted-chat-model");
		session.codexSessionId = "retained-thread";
		session.status = AgentSessionStatus.Complete;
		await handler.handleEvent({ id: "pending", text: "Retained pending turn" });
		const pending = structuredClone(session.metadata?.pendingExecution);
		expect(pending?.model).toBe("accepted-chat-model");
		const saved = JSON.parse(JSON.stringify(handler.serializeState()));
		handler = new ChatSessionHandler(adapter, deps);
		handler.restoreState(saved.sessions, saved.entries);
		config.codexDefaultModel = "future-chat-model";
		config.defaultRunner = "claude";
		const restored = handler.getAllChatSessions()[0]!;
		const status = restored.status;
		delete restored.codexSessionId;
		await expect(handler.resumeBlockedSession(session.id)).rejects.toThrow(
			"Restore the saved conversation ID before resuming",
		);
		expect(observed).toHaveLength(2);
		expect(prompts).toEqual(["Initial task", "Retained pending turn"]);
		expect(restored.codexSessionId).toBeUndefined();
		expect(restored.status).toBe(status);
		expect(restored.metadata?.pendingExecution).toEqual(pending);
		// Restoring the missing prerequisite permits the same pending turn to resume.
		restored.codexSessionId = "retained-thread";
		await handler.resumeBlockedSession(session.id);
		expect(observed[2]).toMatchObject({
			runner: "codex",
			model: "accepted-chat-model",
			resumeSessionId: "retained-thread",
		});
		expect(restored.codexSessionId).toBe("retained-thread");
		expect(restored.metadata?.pendingExecution).toEqual(pending);
		expect(prompts).toEqual([
			"Initial task",
			"Retained pending turn",
			"Retained pending turn",
		]);
		// Legacy configs with no saved model still receive the current default.
		deps.createRunner({ workingDirectory: home }, "codex");
		expect(observed[3].model).toBe("future-chat-model");
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});
