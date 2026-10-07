import type { AgentRunnerConfig, RunnerType } from "bobs-factory-core";
import { z } from "zod";

export const serviceTierRunners = ["codex", "claude"] as const;

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
	serviceTier: z.enum(["standard", "fast"]).optional(),
};
export const AgentSettingsSchema = z.object(agentSettings);
export type AgentSettings = z.infer<typeof AgentSettingsSchema>;

/** Inherit only within one provider; never send a Codex effort to another runner. */
export function resolveAgentSettings(
	runner: RunnerType,
	settings: Pick<
		AgentSettings,
		"reasoningEffort" | "modelVariant" | "serviceTier"
	>,
	inherited?: AgentSettings,
): Pick<
	AgentRunnerConfig,
	"modelReasoningEffort" | "effort" | "modelVariant" | "serviceTier"
> {
	const sameProvider = inherited?.runner === runner;
	const reasoning =
		settings.reasoningEffort ??
		(sameProvider ? inherited.reasoningEffort : undefined);
	const variant =
		settings.modelVariant ??
		(sameProvider ? inherited.modelVariant : undefined);
	const serviceTier =
		settings.serviceTier ?? (sameProvider ? inherited.serviceTier : undefined);
	if (
		serviceTier &&
		!serviceTierRunners.some((supported) => supported === runner)
	)
		throw new Error(`Service tier is not supported by the ${runner} runner`);
	const resolved: ReturnType<typeof resolveAgentSettings> = serviceTier
		? { serviceTier }
		: {};
	if (variant && runner !== "opencode")
		throw new Error(
			"Model variants require OpenCode; use reasoning effort for Claude or Codex",
		);
	if (reasoning) {
		if (runner === "codex")
			return { ...resolved, modelReasoningEffort: reasoning };
		if (runner === "claude") {
			const effort = z.enum(reasoningLevels.claude).parse(reasoning);
			return { ...resolved, effort };
		}
		throw new Error(
			`Reasoning effort is not supported by the ${runner} runner; OpenCode uses model variants`,
		);
	}
	return variant ? { ...resolved, modelVariant: variant } : resolved;
}
