import { AgentSessionStatus } from "cyrus-core";
import { expect, it, vi } from "vitest";
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
		selectWorkflow: () => ({ id: "simple", chat: true }),
		continueSimple: vi.fn(),
		updateViewState: vi.fn(),
	};
	const worker = Object.assign(Object.create(EdgeWorker.prototype), {
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
it("does not steer a stopped Cyrus runner while its process is still closing", () => {
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
it("continues a legacy Cyrus session once, then permits live steering in that same continuation", async () => {
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
