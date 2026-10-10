import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSessionStatus } from "bobs-factory-core";
import { expect, it, vi } from "vitest";
import { ChatSessionHandler } from "../src/ChatSessionHandler.js";
import { EdgeWorker } from "../src/EdgeWorker.js";
import {
	SessionSemaphore,
	waitForRunnerCapacity,
} from "../src/RunnerConcurrency.js";
import { RunnerConfigBuilder } from "../src/RunnerConfigBuilder.js";
import { RunnerSelectionService } from "../src/RunnerSelectionService.js";

function productionFixture(platform: "slack" | "zulip", home: string) {
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
		runnerSlots: new SessionSemaphore(1),
		titleSession: () => undefined,
		requireSessionWorkflowAvailable: () => {},
		emit: () => {},
		prepareRunTitle: () => {},
		startRunTitle: () => {},
		skillsPluginResolver: {
			resolve: async () => [],
			discoverSkillNames: async () => [],
		},
		savePersistedState: async (_force: boolean, update?: () => unknown) => {
			update?.();
		},
		handleClaudeError: (error: unknown) => {
			throw error;
		},
		activeWebhookCount: 0,
		buildRunnerForType: (runner: string, runnerConfig: any) => {
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
	return { config, worker, observed, prompts, deps, adapter };
}

it.each([
	"slack",
	"zulip",
] as const)("persists and resumes the accepted %s model through production runner wiring", async (platform) => {
	const home = mkdtempSync(join(tmpdir(), "chat-model-recovery-"));
	try {
		const { config, observed, prompts, deps, adapter } = productionFixture(
			platform,
			home,
		);
		let handler = new ChatSessionHandler(adapter, deps);
		await handler.handleEvent({ id: "initial", text: "Initial task" });
		await vi.waitFor(() => expect(prompts).toEqual(["Initial task"]));
		const session = handler.getAllChatSessions()[0]!;
		expect(session.metadata?.pendingExecution?.model).toBe(
			"accepted-chat-model",
		);
		expect(observed[0].model).toBe("accepted-chat-model");
		session.codexSessionId = "retained-thread";
		session.status = AgentSessionStatus.Complete;
		await handler.handleEvent({ id: "pending", text: "Retained pending turn" });
		await vi.waitFor(() => expect(prompts).toHaveLength(2));
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
		await vi.waitFor(() => expect(prompts).toHaveLength(3));
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

it.each([
	"slack",
	"zulip",
] as const)("resumes a never-started %s turn after capacity cancellation and restart", async (platform) => {
	const home = mkdtempSync(join(tmpdir(), "chat-first-recovery-"));
	const f = productionFixture(platform, home);
	const holder = await f.worker.runnerSlots.acquireLease();
	try {
		let handler = new ChatSessionHandler(f.adapter, f.deps);
		await handler.handleEvent({ id: "first", text: "Retained initial task" });
		const session = handler.getAllChatSessions()[0]!;
		expect(f.prompts).toEqual([]);
		expect(session.codexSessionId).toBeUndefined();
		expect(session.metadata?.chatExecutionStarted).toBe(false);
		const pending = structuredClone(session.metadata?.pendingExecution);
		handler.interruptWorkflowSession(session.id);
		await waitForRunnerCapacity(session.agentRunner!).catch(() => {});
		const saved = JSON.parse(JSON.stringify(handler.serializeState()));
		handler = new ChatSessionHandler(f.adapter, f.deps);
		handler.restoreState(saved.sessions, saved.entries);
		const restored = handler.getAllChatSessions()[0]!;
		f.config.defaultRunner = "claude";
		f.config.codexDefaultModel = "future-chat-model";
		await holder.release();
		// The owning catalog controls automatic recovery until explicit Resume.
		f.deps.requireWorkflowAvailable = () => {
			throw new Error("Resume individually");
		};
		await handler.recoverQueuedSessions();
		expect(f.prompts).toEqual([]);
		expect(restored.metadata?.pendingExecution).toEqual(pending);
		f.deps.requireWorkflowAvailable = () => {};
		await handler.resumeBlockedSession(session.id);
		await vi.waitFor(() =>
			expect(f.prompts).toEqual(["Retained initial task"]),
		);
		expect(f.observed[1]).toMatchObject({
			runner: "codex",
			model: "accepted-chat-model",
		});
		expect(f.observed[1].resumeSessionId).toBeUndefined();
		expect(restored.id).toBe(session.id);
		expect(restored.metadata?.pendingExecution).toEqual(pending);
		expect(restored.metadata?.chatExecutionStarted).toBe(true);
		// After execution starts, losing identity can no longer start a new conversation.
		await expect(handler.resumeBlockedSession(session.id)).rejects.toThrow(
			"Restore the saved conversation ID",
		);
		expect(f.prompts).toEqual(["Retained initial task"]);
		// Older records provide no proof that a provider never started.
		delete restored.metadata!.chatExecutionStarted;
		await expect(handler.resumeBlockedSession(session.id)).rejects.toThrow(
			"Restore the saved conversation ID",
		);
		expect(f.observed).toHaveLength(2);
	} finally {
		await holder.release();
		rmSync(home, { recursive: true, force: true });
	}
});

it.each([
	["slack", false],
	["zulip", false],
	["slack", true],
	["zulip", true],
] as const)("recovers %s checkpoint cancellation conservatively (cleanup fails: %s)", async (platform, cleanupFails) => {
	const home = mkdtempSync(join(tmpdir(), "chat-checkpoint-recovery-"));
	try {
		const f = productionFixture(platform, home);
		let handler = new ChatSessionHandler(f.adapter, f.deps);
		let releaseCheckpoint!: () => void;
		const checkpoint = new Promise<void>((resolve) => {
			releaseCheckpoint = resolve;
		});
		let checkpointSaved = false;
		let saved: ReturnType<typeof handler.serializeState> | undefined;
		f.worker.savePersistedState = async (
			_force: boolean,
			update?: () => () => void,
		) => {
			const rollback = update?.();
			try {
				const session = handler.getAllChatSessions()[0];
				if (
					cleanupFails &&
					checkpointSaved &&
					session?.metadata?.chatExecutionStarted === false
				)
					throw new Error("cleanup storage unavailable");
				saved = JSON.parse(JSON.stringify(handler.serializeState()));
				if (!checkpointSaved && session?.metadata?.chatExecutionStarted) {
					checkpointSaved = true;
					await checkpoint;
				}
			} catch (error) {
				rollback?.();
				throw error;
			}
		};
		await handler.handleEvent({ id: "first", text: "Retained initial task" });
		await vi.waitFor(() => expect(checkpointSaved).toBe(true));
		const session = handler.getAllChatSessions()[0]!;
		const pending = structuredClone(session.metadata?.pendingExecution);
		expect(session.metadata?.chatExecutionStarted).toBe(true);
		handler.interruptWorkflowSession(session.id);
		releaseCheckpoint();
		await expect(waitForRunnerCapacity(session.agentRunner!)).rejects.toThrow(
			cleanupFails ? "cleanup storage unavailable" : "cancelled",
		);
		expect(f.prompts).toEqual([]);
		expect(f.worker.runnerSlots.active).toBe(0);
		expect(session.metadata?.chatExecutionStarted).toBe(cleanupFails);
		handler = new ChatSessionHandler(f.adapter, f.deps);
		handler.restoreState(saved!.sessions, saved!.entries);
		const restored = handler.getAllChatSessions()[0]!;
		expect(restored.metadata?.chatExecutionStarted).toBe(cleanupFails);
		expect(restored.metadata?.pendingExecution).toEqual(pending);
		expect(restored.codexSessionId).toBeUndefined();
		f.config.codexDefaultModel = "future-chat-model";
		if (cleanupFails) {
			await expect(handler.resumeBlockedSession(session.id)).rejects.toThrow(
				"Restore the saved conversation ID",
			);
			expect(f.prompts).toEqual([]);
		} else {
			await handler.resumeBlockedSession(session.id);
			await vi.waitFor(() =>
				expect(f.prompts).toEqual(["Retained initial task"]),
			);
			expect(f.observed[1]).toMatchObject({
				runner: "codex",
				model: "accepted-chat-model",
			});
			expect(f.observed[1].resumeSessionId).toBeUndefined();
			expect(restored.metadata?.chatExecutionStarted).toBe(true);
		}
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});
