import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSessionStatus } from "cyrus-core";
import { afterEach, expect, it, vi } from "vitest";
import { ChatSessionHandler } from "../src/ChatSessionHandler.js";
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
	const notifyBusy = vi.fn(async () => {});
	const onNewSession = vi.fn();
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
			cyrusHome: home,
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
				buildChatConfig: (input: unknown) => input,
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
	};
}

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
				available: false,
				reason: "The conversation is resuming.",
			});
			expect(() =>
				f.handler.sendMessage(f.session.id, "Duplicate dashboard start"),
			).toThrow("resuming");
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
