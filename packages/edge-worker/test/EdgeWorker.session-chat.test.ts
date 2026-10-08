import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSessionStatus } from "bobs-factory-core";
import { expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager.js";
import { ChatSessionHandler } from "../src/ChatSessionHandler.js";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { SessionChat } from "../src/factory/SessionChat.js";

function fixture() {
	const session = {
		id: "session",
		status: AgentSessionStatus.Active,
		repositories: [{ repositoryId: "repo" }],
		agentRunner: {
			isRunning: () => true,
			isStreaming: () => true,
			supportsStreamingInput: true,
			addStreamMessage: vi.fn(),
		},
	};
	const run = { workflow: { id: "simple", chat: true }, status: "running" };
	const runtime = {
		runs: new Map([[session.id, run]]),
		isExecuting: () => false,
		listWorkflows: () => [{ id: "simple", chat: true, allowedTriggers: [] }],
		continueSimple: vi.fn(),
		updateViewState: vi.fn(),
	};
	const worker = Object.assign(Object.create(EdgeWorker.prototype), {
		chatSessionHandler: null,
		zulipChatSessionHandler: null,
		agentSessionManager: {
			getSession: () => session,
			createResponseActivity: vi.fn(),
		},
		getFactoryRuntime: () => runtime,
		factoryChat: new SessionChat(),
		chatContinuations: new Set(),
		askUserQuestionHandler: { hasPendingQuestion: () => false },
		sessionRepositories: new Map([[session.id, "repo"]]),
		repositories: new Map([["repo", { isActive: true }]]),
		savePersistedState: vi.fn(),
		resumeAgentSession: vi.fn(async () => {}),
	});
	return { worker, session, run, runtime };
}
it("does not steer a stopped Bob’s Factory runner while its process is still closing", () => {
	const { worker, session, run } = fixture();
	worker.sendFactoryChat(session.id, "Live instruction");
	expect(session.agentRunner.addStreamMessage).toHaveBeenCalledExactlyOnceWith(
		"Live instruction",
	);
	run.status = "stopped";
	expect(worker.factoryChatState(session.id).available).toBe(false);
	expect(() => worker.sendFactoryChat(session.id, "Too late")).toThrow(
		"stopped",
	);
	expect(session.agentRunner.addStreamMessage).toHaveBeenCalledTimes(1);
});

it.each([
	"slack",
	"zulip",
] as const)("routes %s dashboard feedback to the owning conversation and supports a new follow-up", async (platform) => {
	const home = mkdtempSync(join(tmpdir(), "dashboard-chat-"));
	try {
		const { worker, runtime } = fixture();
		runtime.runs.clear();
		const onNewSession = vi.fn();
		const onSessionChange = vi.fn();
		const starts: string[] = [];
		const configs: any[] = [];
		let running = false;
		const stream = vi.fn();
		const stop = vi.fn();
		const handler = new ChatSessionHandler(
			{
				platformName: platform,
				extractTaskInstructions: () => "Investigate inventory counts",
				getThreadKey: () => "channel:thread",
				getEventId: () => "event",
				buildSystemPrompt: () => "Platform system prompt",
				fetchThreadContext: async () => "",
				postReply: vi.fn(async () => {}),
				acknowledgeReceipt: async () => {},
				notifyBusy: async () => {},
			},
			{
				factoryHome: home,
				chatRepositoryProvider: {
					getDefaultRepository: () => ({ id: "repo" }) as any,
					getDefaultLinearWorkspaceId: () => undefined,
					getRepositoryPaths: () => [home],
				},
				runnerConfigBuilder: {
					buildChatConfig: (input: any) => ({
						...input,
						workingDirectory: input.workspacePath,
						runnerType: input.runnerType ?? "codex",
					}),
				} as any,
				createRunner: (config) => {
					configs.push(config);
					return {
						start: async (prompt: string) => {
							starts.push(prompt);
							return { sessionId: "native-chat" };
						},
						supportsStreamingInput: true,
						addStreamMessage: stream,
						isRunning: () => running,
						isStreaming: () => running,
						stop,
						getMessages: () => [],
					} as any;
				},
				onNewSession,
				onSessionChange,
				onWebhookStart: () => {},
				onWebhookEnd: () => {},
				onStateChange: async () => {},
				onClaudeError: () => {},
			},
		);
		worker[
			platform === "slack" ? "chatSessionHandler" : "zulipChatSessionHandler"
		] = handler;
		await handler.handleEvent({});
		const session = handler.getAllChatSessions()[0]!;
		expect(onSessionChange).toHaveBeenCalledWith(session.id);
		session.status = AgentSessionStatus.Complete;
		session.codexSessionId = "native-chat";
		session.displayTitle = "Investigate inventory counts";
		expect(worker.factoryChatState(session.id)).toMatchObject({
			available: true,
			mode: "continue",
		});
		await worker.sendFactoryChat(session.id, "Check reconnects too");
		await worker.sendFactoryChat(session.id, "Queued follow-up");
		await vi.waitFor(() => expect(starts).toHaveLength(3));
		expect(starts[2]).toBe("Queued follow-up");
		expect(starts[1]).toBe("Check reconnects too");
		expect(configs[1]).toMatchObject({
			resumeSessionId: "native-chat",
			runnerType: "codex",
			workingDirectory: session.workspace.path,
			systemPrompt: "Platform system prompt",
		});
		expect(handler.getAllChatSessions()).toHaveLength(1);
		expect(session.displayTitle).toBe("Investigate inventory counts");
		expect(onNewSession).toHaveBeenCalledOnce();
		expect(worker.resumeAgentSession).not.toHaveBeenCalled();
		running = true;
		worker.sendFactoryChat(session.id, "Steer existing chat");
		expect(stream).toHaveBeenCalledExactlyOnceWith("Steer existing chat");
		const saved = handler.serializeState();
		saved.sessions[session.id]!.status = AgentSessionStatus.Complete;
		handler.stopSession(session.id);
		expect(stop).toHaveBeenCalledOnce();
		expect(onSessionChange).toHaveBeenLastCalledWith(session.id);
		expect(worker.factoryChatState(session.id).available).toBe(false);
		expect(() => worker.sendFactoryChat(session.id, "After stop")).toThrow(
			/stopped/,
		);

		// Feedback requiring a new workflow uses the chat's configured default
		// repository, rather than looking only in the issue session manager.
		runtime.selectWorkflow = vi.fn(() => ({
			id: "factory",
			launchFields: [{ name: "prompt", type: "textarea", required: true }],
		}));
		worker.startManualFactoryRun = vi.fn(async () => ({ id: "followup" }));
		await worker.startFactoryFollowup(session.id, "Fix the reconnect bug");
		expect(worker.startManualFactoryRun).toHaveBeenCalledWith(
			expect.objectContaining({
				repositoryId: "repo",
				prompt: "Fix the reconnect bug",
				workflow: "factory",
			}),
			session.id,
		);

		// Restart routes persisted records back to their chat owner. The native
		// conversation can resume without an in-memory webhook event or runner.
		const restored = new ChatSessionHandler(
			(handler as any).adapter,
			(handler as any).deps,
		);
		worker[
			platform === "slack" ? "chatSessionHandler" : "zulipChatSessionHandler"
		] = restored;
		worker.agentSessionManager = new AgentSessionManager();
		worker.agentSessionManager.restoreState(saved.sessions, saved.entries);
		worker.restoreChatSessionOwnership();
		expect(worker.agentSessionManager.getSession(session.id)).toBeUndefined();
		expect(restored.listThreads()).toEqual(handler.listThreads());
		expect(worker.factoryChatState(session.id)).toMatchObject({
			available: true,
			mode: "continue",
		});
		running = false;
		worker.sendFactoryChat(session.id, "Continue after restart");
		await vi.waitFor(() => expect(starts).toHaveLength(3));
		expect(configs[2]).toMatchObject({
			resumeSessionId: "native-chat",
			runnerType: "codex",
			systemPrompt: "Platform system prompt",
		});
		expect(restored.getAllChatSessions()[0]!.displayTitle).toBe(
			session.displayTitle,
		);
		expect(onNewSession).toHaveBeenCalledOnce();
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});
it("continues a legacy Bob’s Factory session once, then permits live steering in that same continuation", async () => {
	const { worker, session, runtime } = fixture();
	runtime.runs.clear();
	session.status = AgentSessionStatus.Complete;
	let running = false;
	session.agentRunner.isRunning = () => running;
	let finish!: () => void;
	worker.resumeAgentSession.mockImplementation(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
	);
	worker.sendFactoryChat(session.id, "Continue");
	expect(worker.resumeAgentSession).toHaveBeenCalledWith(
		session,
		expect.anything(),
		session.id,
		worker.agentSessionManager,
		"Continue",
		"",
		false,
		[],
		undefined,
	);
	expect(() => worker.sendFactoryChat(session.id, "Duplicate")).toThrow(
		"resuming",
	);
	running = true;
	worker.sendFactoryChat(session.id, "Steer continuation");
	expect(session.agentRunner.addStreamMessage).toHaveBeenCalledWith(
		"Steer continuation",
	);
	finish();
	await Promise.resolve();
	await Promise.resolve();
});

it("surfaces failed message persistence without poisoning later state saves", async () => {
	const worker: any = Object.create(EdgeWorker.prototype);
	worker.stateSaveQueue = Promise.resolve();
	worker.serializeMappings = () => ({});
	worker.logger = { debug: vi.fn(), error: vi.fn() };
	worker.persistenceManager = {
		saveEdgeWorkerState: vi
			.fn()
			.mockRejectedValueOnce(new Error("Disk full"))
			.mockResolvedValue(undefined),
	};
	await expect(worker.savePersistedState(true)).rejects.toThrow("Disk full");
	await expect(worker.savePersistedState()).resolves.toBeUndefined();
	expect(worker.persistenceManager.saveEdgeWorkerState).toHaveBeenCalledTimes(
		2,
	);
});
