import { join } from "node:path";
import type { AgentMessage, RunnerType } from "bobs-factory-core";
import { describe, expect, it, vi } from "vitest";
import {
	DEFAULT_MOCK_RESPONSE,
	f1AgentHandlers,
	MockAgentRunner,
	parseF1AgentMode,
} from "../src/MockAgentRunner.js";

describe("F1 agent mode", () => {
	it("defaults to mocks and rejects misspelled opt-ins", () => {
		expect(parseF1AgentMode()).toBe("mock");
		expect(parseF1AgentMode("mock")).toBe("mock");
		expect(parseF1AgentMode("live")).toBe("live");
		expect(() => parseF1AgentMode("true")).toThrow("F1_AGENT_MODE");
		expect(() => parseF1AgentMode("")).toThrow("F1_AGENT_MODE");
		expect(f1AgentHandlers("live")).toBeUndefined();
	});

	it.each<RunnerType>([
		"claude",
		"codex",
		"gemini",
		"cursor",
		"opencode",
	])("intercepts %s with zero-cost events and a normal final response", async (runnerType) => {
		const messages: AgentMessage[] = [];
		const onComplete = vi.fn();
		const runner = f1AgentHandlers(parseF1AgentMode())?.createAgentRunner?.(
			runnerType,
			{
				factoryHome: "/tmp/f1-mock-test",
				onMessage: (message) => {
					messages.push(message);
				},
				onComplete,
			},
		);
		expect(runner).toBeInstanceOf(MockAgentRunner);
		const session = await runner?.start("An arbitrary prompt");
		expect(session).toMatchObject({ isRunning: false });
		expect(session?.sessionId).toMatch(/^f1-mock-/);
		expect(messages.map((message) => message.type)).toEqual([
			"system",
			"assistant",
			"result",
		]);
		expect(messages[1]).toMatchObject({
			message: {
				model: "f1-mock",
				content: [{ type: "text", text: DEFAULT_MOCK_RESPONSE }],
			},
		});
		expect(messages[2]).toMatchObject({
			result: DEFAULT_MOCK_RESPONSE,
			total_cost_usd: 0,
			duration_api_ms: 0,
			usage: { input_tokens: 0, output_tokens: 0 },
		});
		expect(onComplete).toHaveBeenCalledWith(messages);
		expect(runner?.isRunning()).toBe(false);
	});

	it("keeps the resumed session ID and supplies structured fixture output", async () => {
		const response = JSON.stringify({ outcome: "complete", outputs: {} });
		const runner = new MockAgentRunner(
			{ factoryHome: "/tmp/f1-mock-test", resumeSessionId: "f1-mock-existing" },
			response,
		);
		expect((await runner.start("Continue")).sessionId).toBe("f1-mock-existing");
		expect(runner.getMessages().at(-1)).toMatchObject({ result: response });
	});

	it("cancels between events and propagates the error without a completed response", async () => {
		const onError = vi.fn();
		const onComplete = vi.fn();
		const runner = new MockAgentRunner({
			factoryHome: "/tmp/f1-mock-test",
			onError,
			onComplete,
			onMessage: () => runner.stop(),
		});
		await expect(runner.start("Stop this run")).rejects.toThrow("stopped");
		expect(runner.getMessages().map((message) => message.type)).toEqual([
			"system",
		]);
		expect(onError).toHaveBeenCalledOnce();
		expect(onComplete).not.toHaveBeenCalled();
		expect(runner.isRunning()).toBe(false);
	});

	it("completes background title jobs with valid title JSON", async () => {
		const factoryHome = "/tmp/f1-mock-test";
		const runner = f1AgentHandlers("mock", "Role fixture")?.createAgentRunner?.(
			"claude",
			{
				factoryHome,
				workingDirectory: join(factoryHome, "factory", "title-jobs", "run-1"),
			},
		);
		await runner?.start("Generate a title");
		expect(runner?.getMessages().at(-1)).toMatchObject({
			result: JSON.stringify({ title: "F1 mock run" }),
		});
	});
});
