import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSessionStatus, PersistenceManager } from "bobs-factory-core";
import { afterEach, expect, it, vi } from "vitest";
import { ChatSessionHandler } from "../src/ChatSessionHandler.js";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { capRunnerStarts, SessionSemaphore } from "../src/RunnerConcurrency.js";

const homes: string[] = [];
afterEach(() => {
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
async function fixture(
	platform: "slack" | "zulip",
	stage: "config" | "catchup" | "admission",
) {
	const home = mkdtempSync(join(tmpdir(), "chat-start-race-"));
	homes.push(home);
	const gate = deferred();
	const reached = deferred();
	const starts: string[] = [];
	const slots = new SessionSemaphore(1);
	const runners: any[] = [];
	let configReads = 0;
	let threadReads = 0;
	let currentModel = "accepted-chat-model";
	const notifyBusy = vi.fn(async () => {});
	const onNewSession = vi.fn();
	const persistence = new PersistenceManager(join(home, "state"));
	const persistMessage = vi.fn(
		persistence.saveEdgeWorkerState.bind(persistence),
	);
	const worker: any = Object.assign(Object.create(EdgeWorker.prototype), {
		stateSaveQueue: Promise.resolve(),
		persistenceManager: { saveEdgeWorkerState: persistMessage },
		logger: { debug: () => {}, error: () => {} },
		serializeMappings: () => {
			const saved = handler.serializeState();
			return {
				agentSessions: saved.sessions,
				agentSessionEntries: saved.entries,
			};
		},
	});
	const handler = new ChatSessionHandler<{ text: string }>(
		{
			platformName: platform,
			extractTaskInstructions: (event) => event.text,
			getThreadKey: () => "channel:thread",
			getEventId: (event) => event.text,
			getThreadContextTs: () => "1",
			buildSystemPrompt: () => "Chat instructions",
			fetchThreadContext: async () => {
				if (++threadReads === 2 && stage === "catchup") {
					reached.resolve();
					await gate.promise;
				}
				return "";
			},
			postReply: async () => {},
			acknowledgeReceipt: async () => {},
			notifyBusy,
		},
		{
			factoryHome: home,
			chatRepositoryProvider: {
				getDefaultRepository: () => undefined,
				getDefaultLinearWorkspaceId: () => undefined,
				getRepositoryPaths: () => [],
			},
			resolveSkillsConfig: async () => {
				if (++configReads === 2 && stage === "config") {
					reached.resolve();
					await gate.promise;
				}
				return {};
			},
			runnerConfigBuilder: {
				buildChatConfig: (input: object) => ({ ...input, model: currentModel }),
			} as any,
			createRunner: (config, _runnerType, signal) => {
				const finished = deferred();
				let running = false;
				const runner = {
					config,
					start: (prompt: string) => {
						starts.push(prompt);
						running = runners.length > 1;
						return runners.length === 1
							? Promise.resolve({ sessionId: "native-chat" })
							: finished.promise.then(() => ({ sessionId: "native-chat" }));
					},
					finish: async () => {
						running = false;
						await config.onMessage!({
							type: "result",
							subtype: "success",
							is_error: false,
							result: "Done",
							session_id: "native-chat",
						} as any);
						finished.resolve();
					},
					isRunning: () => running,
					supportsStreamingInput: false,
					getMessages: () => [],
					stop: vi.fn(() => {
						running = false;
						finished.resolve();
					}),
				};
				runners.push(runner);
				if (runners.length === 2 && stage === "admission") {
					void slots.acquire();
					reached.resolve();
					void gate.promise.then(() => slots.release());
				}
				const trackedRunner =
					stage === "admission" && runners.length > 1
						? capRunnerStarts(runner as any, slots, signal)
						: runner;
				Object.assign(runner, { trackedRunner });
				return trackedRunner as any;
			},
			onNewSession,
			onWebhookStart: () => {},
			onWebhookEnd: () => {},
			onStateChange: async () => {},
			persistMessage: (update) => worker.savePersistedState(true, update),
			onClaudeError: () => {},
		},
	);
	await handler.handleEvent({ text: "Initial task" });
	const session = handler.getAllChatSessions()[0]!;
	session.codexSessionId = "native-chat";
	session.status = AgentSessionStatus.Complete;
	return {
		handler,
		session,
		gate,
		reached,
		starts,
		runners,
		notifyBusy,
		onNewSession,
		persistMessage,
		persistence,
		worker,
		setCurrentModel: (model: string) => {
			currentModel = model;
		},
	};
}

it.each([
	"slack",
	"zulip",
] as const)("restores the accepted model and pending dashboard input on explicit %s Resume", async (platform) => {
	const f = await fixture(platform, "catchup");
	f.gate.resolve();
	await f.handler.sendMessage(f.session.id, "Interrupted dashboard turn");
	await vi.waitFor(() => expect(f.starts).toHaveLength(2));
	const pending = structuredClone(f.session.metadata?.pendingExecution);
	f.runners[1].stop();
	await vi.waitFor(() =>
		expect(f.handler.isWorkflowStopping(f.session.id)).toBe(false),
	);
	const saved = f.handler.serializeState();
	f.handler.restoreState(saved.sessions, saved.entries);
	f.setCurrentModel("future-chat-model");

	await f.handler.resumeBlockedSession(f.session.id);
	const restored = f.handler.getAllChatSessions()[0]!;
	expect(f.runners[2].config.model).toBe("accepted-chat-model");
	expect(f.runners[2].config.resumeSessionId).toBe("native-chat");
	expect(restored.codexSessionId).toBe("native-chat");
	expect(restored.metadata?.pendingExecution).toEqual(pending);
	expect(f.starts).toEqual([
		"Initial task",
		"Interrupted dashboard turn",
		"Interrupted dashboard turn",
	]);
	await f.runners[2].finish();
	expect(restored.status).toBe(AgentSessionStatus.Complete);
});

it.each([
	"slack",
	"zulip",
] as const)("serializes %s dashboard and platform starts throughout setup", async (platform) => {
	for (const stage of ["config", "catchup", "admission"] as const) {
		for (const origin of ["dashboard", "platform"] as const) {
			const f = await fixture(platform, stage);
			const first =
				origin === "dashboard"
					? f.handler.sendMessage(f.session.id, "First continuation")
					: f.handler.handleEvent({ text: "First continuation" });
			await f.reached.promise;
			expect(f.handler.chatState(f.session.id)).toMatchObject({
				available: true,
				mode: "queue",
			});
			await f.handler.handleEvent({ text: "Queued platform reply 1" });
			await f.handler.handleEvent({ text: "Queued platform reply 2" });
			expect(f.starts).toEqual(["Initial task"]);
			expect(f.notifyBusy).toHaveBeenCalledTimes(2);
			f.gate.resolve();
			await first;
			await vi.waitFor(() => expect(f.starts).toHaveLength(2));
			expect(f.runners).toHaveLength(2);
			expect(f.handler.getRunnerForThread("channel:thread")).toBe(
				f.runners[1].trackedRunner,
			);
			await f.runners[1].finish();
			await vi.waitFor(() => expect(f.starts).toHaveLength(3));
			expect(f.runners).toHaveLength(3);
			await f.runners[2].finish();
			await vi.waitFor(() => expect(f.starts).toHaveLength(4));
			await f.runners[3].finish();
			expect(f.starts).toEqual([
				"Initial task",
				"First continuation",
				"Queued platform reply 1",
				"Queued platform reply 2",
			]);
			for (const runner of f.runners.slice(1)) {
				expect(runner.config).toMatchObject({
					resumeSessionId: "native-chat",
					runnerType: "codex",
					workspacePath: f.session.workspace.path,
				});
			}
			expect(f.onNewSession).toHaveBeenCalledOnce();
		}
	}
});

it.each([
	"config",
	"catchup",
	"admission",
] as const)("does not start a stopped continuation after %s resolves", async (stage) => {
	const f = await fixture("slack", stage);
	f.handler.sendMessage(f.session.id, "Pending feedback");
	await f.reached.promise;
	await f.handler.handleEvent({ text: "Pending platform reply" });
	f.handler.stopSession(f.session.id);
	f.gate.resolve();
	await new Promise(setImmediate);
	expect(f.starts).toEqual(["Initial task"]);
	expect(f.session.status).toBe(AgentSessionStatus.Error);
	expect(f.handler.chatState(f.session.id).available).toBe(false);
});

it("does not redispatch a queued reply when stopped immediately after a result", async () => {
	const f = await fixture("slack", "config");
	f.handler.sendMessage(f.session.id, "First continuation");
	await f.reached.promise;
	await f.handler.handleEvent({ text: "Queued platform reply" });
	f.gate.resolve();
	await vi.waitFor(() => expect(f.starts).toHaveLength(2));
	await f.runners[1].finish();
	f.handler.stopSession(f.session.id);
	await new Promise(setImmediate);
	expect(f.starts).toEqual(["Initial task", "First continuation"]);
	expect(f.session.status).toBe(AgentSessionStatus.Error);
});

it.each([
	"config",
	"catchup",
	"admission",
] as const)("accepts and persists dashboard messages during %s without overlapping turns", async (stage) => {
	const f = await fixture("slack", stage);
	await f.handler.sendMessage(f.session.id, "First continuation", "first");
	await f.reached.promise;
	await f.handler.sendMessage(f.session.id, "Follow-up one", "one");
	await f.handler.sendMessage(f.session.id, "Follow-up two", "two");
	expect(f.handler.chatState(f.session.id)).toMatchObject({
		available: true,
		mode: "queue",
		queuedMessageIds: expect.arrayContaining(["one", "two"]),
	});
	const saved = f.handler.serializeState();
	expect(saved.sessions[f.session.id].metadata?.pendingChatMessages).toEqual([
		{ id: "one", text: "Follow-up one" },
		{ id: "two", text: "Follow-up two" },
	]);
	expect(saved.sessions[f.session.id].metadata?.pendingExecution?.prompt).toBe(
		"First continuation",
	);
	expect(f.starts).toEqual(["Initial task"]);
	f.gate.resolve();
	await vi.waitFor(() => expect(f.starts).toHaveLength(2));
	await f.runners[1].finish();
	await vi.waitFor(() => expect(f.starts).toHaveLength(3));
	expect(f.starts[2]).toBe("Follow-up one\n\nFollow-up two");
	expect(f.session.metadata?.pendingChatMessages).toEqual([]);
	await f.runners[2].finish();
	expect(f.handler.chatState(f.session.id).queuedMessageIds).toEqual([]);
});

it("cancels accepted dashboard messages when a queued continuation is stopped", async () => {
	const f = await fixture("zulip", "admission");
	await f.handler.sendMessage(f.session.id, "First continuation");
	await f.reached.promise;
	await f.handler.sendMessage(f.session.id, "Never execute this");
	f.handler.stopSession(f.session.id);
	f.gate.resolve();
	await new Promise(setImmediate);
	expect(f.starts).toEqual(["Initial task"]);
	expect(f.session.metadata?.pendingChatMessages).toBeUndefined();
});

it("recovers saved dashboard messages after a completed turn without replaying it", async () => {
	const f = await fixture("slack", "catchup");
	f.session.metadata ??= {};
	f.session.metadata.chatSystemPrompt = "Chat instructions";
	f.session.metadata.pendingChatMessages = [
		{ id: "saved-one", text: "Saved follow-up one" },
		{ id: "saved-two", text: "Saved follow-up two" },
	];
	f.gate.resolve();
	const saved = f.handler.serializeState();
	f.handler.restoreState(saved.sessions, saved.entries);
	await f.handler.recoverQueuedSessions();
	await vi.waitFor(() => expect(f.starts).toHaveLength(2));
	expect(f.starts).toEqual([
		"Initial task",
		"Saved follow-up one\n\nSaved follow-up two",
	]);
	await f.runners[1].finish();
});

it("does not deliver an unpersisted message when the current turn completes", async () => {
	const f = await fixture("slack", "config");
	await f.handler.sendMessage(f.session.id, "First continuation");
	await f.reached.promise;
	f.gate.resolve();
	await vi.waitFor(() => expect(f.starts).toHaveLength(2));
	const save = deferred();
	f.persistMessage.mockImplementationOnce(async () => {
		await save.promise;
		throw new Error("Disk full");
	});
	const delivery = f.handler.sendMessage(f.session.id, "Unpersisted message");
	const rejected = expect(delivery).rejects.toThrow("Disk full");
	await f.runners[1].finish();
	await new Promise(setImmediate);
	expect(f.starts).toHaveLength(2);
	save.resolve();
	await rejected;
	expect(f.session.metadata?.pendingChatMessages).toEqual([]);
	expect(f.starts).toHaveLength(2);
});

it("does not recover a rejected concurrent submission saved by another request", async () => {
	const f = await fixture("slack", "config");
	await f.handler.sendMessage(f.session.id, "First continuation", "first");
	await f.reached.promise;
	const saving = deferred();
	const save = deferred();
	let firstSavedMessages: unknown;
	f.persistMessage
		.mockImplementationOnce(async (state) => {
			saving.resolve();
			await save.promise;
			await f.persistence.saveEdgeWorkerState(state);
			firstSavedMessages = (await f.persistence.loadEdgeWorkerState())!
				.agentSessions![f.session.id].metadata?.pendingChatMessages;
		})
		.mockRejectedValueOnce(new Error("Disk full"));
	const accepted = f.handler.sendMessage(
		f.session.id,
		"Accepted input",
		"accepted",
	);
	await saving.promise;
	const rejected = f.handler.sendMessage(
		f.session.id,
		"Rejected input",
		"rejected",
	);
	const rejection = expect(rejected).rejects.toThrow("Disk full");
	await new Promise(setImmediate);
	// Lifecycle saves use the same state file and must observe rollback too.
	const lifecycle = f.worker.savePersistedState();
	save.resolve();
	await accepted;
	await rejection;
	await lifecycle;
	expect(firstSavedMessages).toEqual([
		{ id: "accepted", text: "Accepted input" },
	]);
	const saved = await f.persistence.loadEdgeWorkerState();
	expect(
		saved!.agentSessions![f.session.id].metadata?.pendingChatMessages,
	).toEqual([{ id: "accepted", text: "Accepted input" }]);
	expect(f.session.metadata?.pendingChatMessages).toEqual([
		{ id: "accepted", text: "Accepted input" },
	]);

	// A later retry can succeed; neither it nor recovery resurrects rejected input.
	await f.handler.sendMessage(f.session.id, "Retried input", "retry");
	const retrySaved = await f.persistence.loadEdgeWorkerState();
	f.handler.stopSession(f.session.id);
	f.gate.resolve();
	await new Promise(setImmediate);
	const restored = new ChatSessionHandler(
		(f.handler as any).adapter,
		(f.handler as any).deps,
	);
	f.worker.serializeMappings = () => {
		const state = restored.serializeState();
		return {
			agentSessions: state.sessions,
			agentSessionEntries: state.entries,
		};
	};
	restored.restoreState(
		retrySaved!.agentSessions!,
		retrySaved!.agentSessionEntries!,
	);
	await restored.recoverQueuedSessions();
	await vi.waitFor(() => expect(f.starts).toHaveLength(2));
	await f.runners[1].finish();
	await vi.waitFor(() => expect(f.starts).toHaveLength(3));
	expect(f.starts).toEqual([
		"Initial task",
		"First continuation",
		"Accepted input\n\nRetried input",
	]);
	await f.runners[2].finish();
});
