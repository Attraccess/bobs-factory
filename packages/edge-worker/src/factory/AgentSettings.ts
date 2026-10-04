import type { AgentRunnerConfig, RunnerType } from "cyrus-core";
import { z } from "zod";

export const reasoningLevels = {
	claude: ["low", "medium", "high", "xhigh", "max"],
	codex: [
		"minimal",
		"low",
		"medium",
		"high",
		"xhigh",
		"max",
		"ultra",
		"persistent",
	],
} as const;
export const agentSettings = {
	runner: z
		.enum(["claude", "codex", "gemini", "cursor", "opencode"])
		.optional(),
	model: z.string().trim().min(1).optional(),
	reasoningEffort: z.enum(reasoningLevels.codex).optional(),
	modelVariant: z.string().trim().min(1).max(100).optional(),
};
export const AgentSettingsSchema = z.object(agentSettings);
export type AgentSettings = z.infer<typeof AgentSettingsSchema>;

/** Inherit only within one provider; never send a Codex effort to another runner. */
export function resolveAgentSettings(
	runner: RunnerType,
	settings: Pick<AgentSettings, "reasoningEffort" | "modelVariant">,
	inherited?: AgentSettings,
): Pick<AgentRunnerConfig, "modelReasoningEffort" | "effort" | "modelVariant"> {
	const sameProvider = inherited?.runner === runner;
	const reasoning =
		settings.reasoningEffort ??
		(sameProvider ? inherited.reasoningEffort : undefined);
	const variant =
		settings.modelVariant ??
		(sameProvider ? inherited.modelVariant : undefined);
	if (variant && runner !== "opencode")
		throw new Error(
			"Model variants require OpenCode; use reasoning effort for Claude or Codex",
		);
	if (reasoning) {
		if (runner === "codex") return { modelReasoningEffort: reasoning };
		if (runner === "claude") {
			const effort = z.enum(reasoningLevels.claude).parse(reasoning);
			return { effort };
		}
		throw new Error(
			`Reasoning effort is not supported by the ${runner} runner; OpenCode uses model variants`,
		);
	}
	return variant ? { modelVariant: variant } : {};
}
