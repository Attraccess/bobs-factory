import type { IAgentRunner } from "cyrus-core";

export interface ChatState {
	enabled: boolean;
	available: boolean;
	mode?: "steer" | "continue" | "queue";
	queuedMessageIds?: string[];
	step?: string;
	reason?: string;
}

export function steeringState(runner?: IAgentRunner): ChatState {
	if (!runner?.isRunning())
		return {
			enabled: true,
			available: false,
			reason: "The agent is starting or finishing. Try again shortly.",
		};
	if (!runner.supportsStreamingInput || !runner.addStreamMessage)
		return {
			enabled: true,
			available: false,
			reason:
				"This runner cannot receive messages while working. Wait for the Cyrus session to finish.",
		};
	if (runner.isStreaming && !runner.isStreaming())
		return {
			enabled: true,
			available: false,
			reason: "The agent is finishing its turn. Try again shortly.",
		};
	return { enabled: true, available: true, mode: "steer" };
}

/** Keep actual live targets instead of routing fanout messages to the last runner. */
export class SessionChat {
	private targets = new Map<
		string,
		Map<IAgentRunner, { enabled: boolean; step: string }>
	>();
	register(
		id: string,
		runner: IAgentRunner,
		enabled: boolean,
		step: string,
	): () => void {
		const targets = this.targets.get(id) ?? new Map();
		targets.set(runner, { enabled, step });
		this.targets.set(id, targets);
		return () => {
			targets.delete(runner);
			if (!targets.size) this.targets.delete(id);
		};
	}
	state(id: string, enabled: boolean): ChatState {
		const targets = this.targets.get(id);
		if (!targets?.size)
			return {
				enabled,
				available: false,
				reason: "Chat is available while an agent step is working.",
			};
		if (targets.size > 1)
			return {
				enabled: enabled || [...targets.values()].some((t) => t.enabled),
				available: false,
				reason:
					"Several agents are working in parallel. Chat resumes when one agent is active.",
			};
		const [runner, target] = [...targets][0]!;
		if (!target.enabled) return { enabled: false, available: false };
		return { ...steeringState(runner), step: target.step };
	}
	send(id: string, text: string): void {
		const state = this.state(id, false);
		if (!state.available)
			throw new Error(state.reason ?? "Chat is disabled for this step");
		const runner = this.targets.get(id)!.keys().next().value!;
		runner.addStreamMessage!(text);
	}
}
