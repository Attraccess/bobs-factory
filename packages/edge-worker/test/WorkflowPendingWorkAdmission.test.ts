import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSessionStatus } from "bobs-factory-core";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: vi.fn() }));

import { query } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeRunner } from "bobs-factory-claude-runner";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import { MachineCapacity } from "../src/MachineCapacity.js";

const homes: string[] = [];
afterEach(() => {
	vi.clearAllMocks();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});

// Drive the installed runner's Stop hook and query lifecycle. The SDK's timers
// and background notifications stay inside that query, not a Factory scheduler.
it.each([
	"sessionCrons",
	"backgroundTasks",
])("disabling Simple aborts native %s and blocks later starts until explicit Resume", async (kind) => {
	const home = mkdtempSync(join(tmpdir(), "pending-admission-"));
	homes.push(home);
	const capacity = new MachineCapacity(1, join(home, "capacity"));
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		tool: async () => ({}),
		script: async () => ({}),
	});
	let options: any;
	let notify: (() => void) | undefined;
	let done = false;
	const messages: any[] = [
		{ type: "system", subtype: "init", session_id: "native-thread" },
	];
	const callbacks = vi.fn();
	const result = (text: string) => ({
		type: "result",
		subtype: "success",
		is_error: false,
		result: text,
		session_id: "native-thread",
		duration_ms: 1,
		num_turns: 1,
	});
	vi.mocked(query).mockImplementation(((input: any) => {
		options = input.options;
		options.abortController.signal.addEventListener(
			"abort",
			() => {
				done = true;
				notify?.();
			},
			{ once: true },
		);
		return {
			async *[Symbol.asyncIterator]() {
				while (!done) {
					if (messages.length) yield messages.shift();
					else
						await new Promise<void>((resolve) => {
							notify = resolve;
						});
				}
			},
		};
	}) as any);
	const runner = new ClaudeRunner(
		{ workingDirectory: home, factoryHome: home },
		false,
	);
	const session: any = {
		id: "native",
		status: AgentSessionStatus.Complete,
		claudeSessionId: "native-thread",
		agentRunner: undefined,
	};
	const worker: any = Object.create(EdgeWorker.prototype);
	Object.assign(worker, {
		factoryHome: home,
		runnerSlots: capacity,
		getFactoryRuntime: () => runtime,
		buildRunnerForType: () => runner,
		titleSession: () => session,
		getAllKnownSessions: () => [session],
		getLaunchAdmission: () => ({ values: () => [] }),
		preparationStarts: new Map(),
		cancelRunTitle: vi.fn(),
		chatHandlerForSession: () => undefined,
		emit: vi.fn(),
		savePersistedState: vi.fn(async () => {}),
	});
	session.agentRunner = worker.createRunnerForType(
		"claude",
		{ workingDirectory: home },
		undefined,
		session.id,
	);
	const observed: any[] = [];
	runner.on("message", (message) => observed.push(message));
	const pending = session.agentRunner.startStreaming(
		"Schedule controlled pending work",
	);
	try {
		await vi.waitFor(() => expect(options?.hooks?.Stop).toBeDefined());
		const work =
			kind === "sessionCrons"
				? {
						id: "cron",
						schedule: "* * * * *",
						recurring: false,
						prompt: "Controlled wakeup",
					}
				: {
						id: "task",
						type: "shell",
						status: "running",
						description: "Controlled background task",
						command: "fixture",
					};
		for (const matcher of options.hooks.Stop)
			for (const hook of matcher.hooks)
				await hook(
					{
						hook_event_name: "Stop",
						session_crons: kind === "sessionCrons" ? [work] : [],
						background_tasks: kind === "backgroundTasks" ? [work] : [],
					},
					undefined,
					{ signal: options.abortController.signal },
				);
		messages.push(result("Pending work registered"));
		notify?.();
		await vi.waitFor(() =>
			expect(observed.some((m) => m.type === "result")).toBe(true),
		);
		expect(runner.getPendingWork()[kind]).toEqual([work]);
		expect(session.agentRunner.isRunning()).toBe(true);
		const wake = () => {
			if (options.abortController.signal.aborted) return false;
			callbacks();
			messages.push(result("Controlled automatic turn"));
			notify?.();
			return true;
		};
		expect(wake()).toBe(true);
		await vi.waitFor(() =>
			expect(observed.filter((m) => m.type === "result")).toHaveLength(2),
		);
		expect(worker.nativeWorkflowImpact("simple")).toContain(session.id);
		runtime.catalog.setEnabled("simple", false);
		worker.interruptDisabledSessions();
		await pending;
		expect(options.abortController.signal.aborted).toBe(true);
		expect(wake()).toBe(false);
		expect(callbacks).toHaveBeenCalledTimes(1);
		expect((await capacity.snapshot()).requests).toEqual([]);
		expect(runtime.catalog.getBlock(session.id)).toBeDefined();
		await expect(
			session.agentRunner.startStreaming("Disabled automatic restart"),
		).rejects.toThrow(/disabled|unavailable/);
		runtime.catalog.setEnabled("simple", true);
		expect(runtime.catalog.getBlock(session.id)).toBeDefined();
		await expect(
			session.agentRunner.startStreaming("Enabled without Resume"),
		).rejects.toThrow(/disabled|Resume/);
		expect(query).toHaveBeenCalledTimes(1);
		expect(session.claudeSessionId).toBe("native-thread");
	} finally {
		session.agentRunner.stop();
		await pending.catch(() => {});
		await capacity.shutdown();
	}
});
