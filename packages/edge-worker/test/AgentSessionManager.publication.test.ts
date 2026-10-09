import type { SDKMessage } from "bobs-factory-core";
import { expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager.js";

it("retains Factory results locally without publishing unvalidated JSON or duplicating questions", async () => {
	const manager = new AgentSessionManager();
	const postActivity = vi.fn(async () => ({ activityId: "activity" }));
	manager.createCyrusAgentSession(
		"session",
		"issue",
		{
			id: "issue",
			identifier: "EX-1",
			title: "Fixture",
			description: "",
			branchName: "fixture",
		},
		{ path: "/tmp/fixture", isGitWorktree: false },
	);
	manager.setActivitySink("session", {
		id: "workspace",
		postActivity,
		createAgentSession: async () => "session",
	});
	const raw =
		'{"status":"blocked","summary":"Need access","questions":["Which test issue?"]}';
	const assistant = (text: string): SDKMessage =>
		({
			type: "assistant",
			session_id: "native",
			parent_tool_use_id: null,
			uuid: "fixture",
			message: {
				id: "message",
				type: "message",
				role: "assistant",
				model: "fixture",
				stop_reason: "end_turn",
				stop_sequence: null,
				usage: { input_tokens: 0, output_tokens: 0 },
				content: [{ type: "text", text }],
			},
		}) as SDKMessage;
	const result = {
		type: "result",
		subtype: "success",
		session_id: "native",
		result: raw,
		is_error: false,
		duration_ms: 1,
		total_cost_usd: 0,
		usage: { input_tokens: 0, output_tokens: 0 },
	} as SDKMessage;
	for (const message of [
		assistant("I’ll check the repository access."),
		assistant(raw),
		result,
	]) {
		manager.markFactoryMessage(message);
		await manager.handleClaudeMessage("session", message);
	}
	expect(postActivity.mock.calls.map((call: unknown[]) => call[1])).toEqual([
		{ type: "thought", body: "I’ll check the repository access." },
	]);
	expect(
		manager.getSessionEntries("session").map((entry) => entry.content),
	).toEqual(["I’ll check the repository access.", raw]);
	expect(
		manager.serializeState().entries.session.at(-1)?.metadata
			?.factoryPublication,
	).toBe(true);
});

it("keeps parallel Factory role results in their own presentation buffers", async () => {
	const manager = new AgentSessionManager();
	const postActivity = vi.fn(async () => ({}));
	manager.createCyrusAgentSession(
		"parallel",
		"issue",
		{
			id: "issue",
			identifier: "EX-2",
			title: "Parallel roles",
			description: "",
			branchName: "fixture",
		},
		{ path: "/tmp/fixture", isGitWorktree: false },
	);
	manager.setActivitySink("parallel", {
		id: "workspace",
		postActivity,
		createAgentSession: async () => "parallel",
	});
	const send = async (
		step: string,
		type: "assistant" | "result",
		text: string,
	) => {
		const message = (
			type === "assistant"
				? {
						type,
						session_id: step,
						parent_tool_use_id: null,
						message: { content: [{ type: "text", text }] },
					}
				: {
						type,
						subtype: "success",
						session_id: step,
						result: text,
						is_error: false,
						duration_ms: 0,
						usage: {},
					}
		) as SDKMessage;
		manager.markFactoryMessage(message, step);
		await manager.handleClaudeMessage("parallel", message);
	};
	await send("review-a", "assistant", '{"summary":"A"}');
	await send("review-b", "assistant", '{"summary":"B"}');
	await send("review-a", "result", '{"summary":"A"}');
	await send("review-b", "result", '{"summary":"B"}');
	expect(
		manager.getSessionEntries("parallel").map((entry) => ({
			content: entry.content,
			step: entry.metadata?.factoryStepKey,
		})),
	).toEqual([
		{ content: '{"summary":"A"}', step: "review-a" },
		{ content: '{"summary":"B"}', step: "review-b" },
	]);
	expect(postActivity).not.toHaveBeenCalled();
});
