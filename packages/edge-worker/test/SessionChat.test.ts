import type { IAgentRunner } from "cyrus-core";
import { expect, it, vi } from "vitest";
import { SessionChat } from "../src/factory/SessionChat.js";

function runner() {
	return {
		isRunning: () => true,
		isStreaming: () => true,
		supportsStreamingInput: true,
		addStreamMessage: vi.fn(),
	} as unknown as IAgentRunner;
}
it("steers exactly the active opted-in agent and rejects ambiguous fanout", () => {
	const chat = new SessionChat(),
		first = runner(),
		second = runner();
	const finish = chat.register("run", first, true, "pipeline/inspect");
	expect(chat.state("run", false)).toMatchObject({
		available: true,
		mode: "steer",
		step: "pipeline/inspect",
	});
	chat.send("run", "Use the new requirement");
	expect(first.addStreamMessage).toHaveBeenCalledWith(
		"Use the new requirement",
	);
	const finishSecond = chat.register("run", second, false, "pipeline/other");
	expect(() => chat.send("run", "Ambiguous")).toThrow("parallel");
	expect(second.addStreamMessage).not.toHaveBeenCalled();
	finishSecond();
	finish();
	expect(chat.state("run", true).available).toBe(false);
});
it("honors opt-out and surfaces unsupported input and terminal-turn races", () => {
	const chat = new SessionChat(),
		target = runner();
	const finish = chat.register("run", target, false, "work");
	expect(() => chat.send("run", "No")).toThrow("disabled");
	finish();
	chat.register("run", target, true, "work");
	target.isStreaming = () => false;
	expect(chat.state("run", true).available).toBe(false);
	expect(() => chat.send("run", "No")).toThrow("finishing");
	target.isStreaming = () => true;
	vi.mocked(target.addStreamMessage!).mockImplementation(() => {
		throw new Error("Turn ended");
	});
	expect(() => chat.send("run", "Late")).toThrow("Turn ended");
	expect(chat.state("unknown", false).enabled).toBe(false);
});
