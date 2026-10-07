import { randomUUID } from "node:crypto";
import { join, sep } from "node:path";
import { ClaudeMessageFormatter } from "cyrus-claude-runner";
import type {
	AgentMessage,
	AgentRunnerConfig,
	AgentSessionInfo,
	EdgeWorkerConfig,
	IAgentRunner,
} from "cyrus-core";

export type F1AgentMode = "mock" | "live";

export function parseF1AgentMode(value?: string): F1AgentMode {
	if (value === undefined || value === "mock") return "mock";
	if (value === "live") return "live";
	throw new Error("F1_AGENT_MODE must be mock or live");
}

export const DEFAULT_MOCK_RESPONSE =
	"F1 mock agent completed. No agent CLI or inference API was invoked.";

export function f1AgentHandlers(
	mode: F1AgentMode,
	response = DEFAULT_MOCK_RESPONSE,
): EdgeWorkerConfig["handlers"] {
	return mode === "mock"
		? {
				createAgentRunner: (_runnerType, config) => {
					// Title jobs have their own workspace and require JSON, independent of
					// the session/role response fixture.
					const titleDirectory =
						join(config.cyrusHome, "factory", "title-jobs") + sep;
					const reply = config.workingDirectory?.startsWith(titleDirectory)
						? JSON.stringify({ title: "F1 mock run" })
						: response;
					return new MockAgentRunner(config, reply);
				},
			}
		: undefined;
}

/** A deterministic provider boundary: emits real runner events without I/O. */
export class MockAgentRunner implements IAgentRunner {
	readonly supportsStreamingInput = false;
	private messages: AgentMessage[] = [];
	private running = false;
	private stopped = false;
	private readonly formatter = new ClaudeMessageFormatter();

	constructor(
		private readonly config: AgentRunnerConfig,
		private readonly response = DEFAULT_MOCK_RESPONSE,
	) {}

	async start(_prompt: string): Promise<AgentSessionInfo> {
		if (this.running) throw new Error("F1 mock runner is already running");
		this.running = true;
		this.stopped = false;
		const startedAt = new Date();
		const sessionId = this.config.resumeSessionId ?? `f1-mock-${randomUUID()}`;
		const usage: Extract<
			AgentMessage,
			{ type: "result"; subtype: "success" }
		>["usage"] = {
			input_tokens: 0,
			output_tokens: 0,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 0,
			cache_creation: {
				ephemeral_1h_input_tokens: 0,
				ephemeral_5m_input_tokens: 0,
			},
			fallback_credit: {
				status: { type: "not_applied", reason: "not_enabled" },
			},
			inference_geo: "unknown",
			iterations: [],
			output_tokens_details: { thinking_tokens: 0 },
			server_tool_use: { web_fetch_requests: 0, web_search_requests: 0 },
			service_tier: "standard",
			speed: "standard",
		};
		const emit = async (message: AgentMessage) => {
			if (this.stopped) throw new Error("F1 mock runner stopped");
			this.messages.push(message);
			await this.config.onMessage?.(message);
		};
		try {
			await emit({
				type: "system",
				subtype: "init",
				session_id: sessionId,
				uuid: randomUUID(),
				apiKeySource: "none",
				claude_code_version: "f1-mock",
				cwd: this.config.workingDirectory ?? process.cwd(),
				tools: [],
				mcp_servers: [],
				model: "f1-mock",
				permissionMode: "default",
				slash_commands: [],
				output_style: "default",
				skills: [],
				plugins: [],
			});
			await emit({
				type: "assistant",
				session_id: sessionId,
				uuid: randomUUID(),
				parent_tool_use_id: null,
				message: {
					id: randomUUID(),
					type: "message",
					role: "assistant",
					model: "f1-mock",
					content: [{ type: "text", text: this.response, citations: null }],
					stop_reason: "end_turn",
					stop_sequence: null,
					stop_details: null,
					container: null,
					context_management: null,
					diagnostics: null,
					usage,
				},
			});
			await emit({
				type: "result",
				subtype: "success",
				session_id: sessionId,
				uuid: randomUUID(),
				duration_ms: Date.now() - startedAt.getTime(),
				duration_api_ms: 0,
				is_error: false,
				num_turns: 1,
				result: this.response,
				stop_reason: "end_turn",
				total_cost_usd: 0,
				usage,
				modelUsage: {},
				permission_denials: [],
			});
			await this.config.onComplete?.(this.getMessages());
			return { sessionId, startedAt, isRunning: false };
		} catch (error) {
			await this.config.onError?.(
				error instanceof Error ? error : new Error(String(error)),
			);
			throw error;
		} finally {
			this.running = false;
		}
	}

	stop(): void {
		this.stopped = true;
	}
	isRunning(): boolean {
		return this.running;
	}
	getMessages(): AgentMessage[] {
		return [...this.messages];
	}
	getFormatter(): ClaudeMessageFormatter {
		return this.formatter;
	}
}
