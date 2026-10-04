import { expect, it } from "vitest";
import {
	AgentSettingsSchema,
	resolveAgentSettings,
} from "../src/factory/AgentSettings.js";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { validateWorkflows } from "../src/factory/Workflow.js";

it("maps reasoning and variants to native runner settings with same-provider inheritance", () => {
	expect(resolveAgentSettings("codex", { reasoningEffort: "ultra" })).toEqual({
		modelReasoningEffort: "ultra",
	});
	expect(resolveAgentSettings("claude", { reasoningEffort: "xhigh" })).toEqual({
		effort: "xhigh",
	});
	expect(
		resolveAgentSettings("opencode", { modelVariant: "custom-review" }),
	).toEqual({ modelVariant: "custom-review" });
	expect(
		resolveAgentSettings(
			"codex",
			{},
			{ runner: "codex", reasoningEffort: "high" },
		),
	).toEqual({ modelReasoningEffort: "high" });
	expect(
		resolveAgentSettings(
			"codex",
			{ reasoningEffort: "low" },
			{ runner: "codex", reasoningEffort: "high" },
		),
	).toEqual({ modelReasoningEffort: "low" });
	expect(
		resolveAgentSettings(
			"claude",
			{},
			{ runner: "codex", reasoningEffort: "ultra" },
		),
	).toEqual({});
	expect(
		resolveAgentSettings(
			"codex",
			{},
			{ runner: "opencode", modelVariant: "high" },
		),
	).toEqual({});
	expect(
		resolveAgentSettings(
			"opencode",
			{},
			{ runner: "opencode", modelVariant: "high" },
		),
	).toEqual({ modelVariant: "high" });
});

it("rejects unsupported settings instead of silently running with a different effort", () => {
	expect(() =>
		resolveAgentSettings("claude", { reasoningEffort: "ultra" }),
	).toThrow();
	expect(() =>
		resolveAgentSettings("gemini", { reasoningEffort: "high" }),
	).toThrow("not supported");
	expect(() =>
		resolveAgentSettings("opencode", { reasoningEffort: "high" }),
	).toThrow("model variants");
	expect(() =>
		resolveAgentSettings("codex", { modelVariant: "custom" }),
	).toThrow("require OpenCode");
	expect(() =>
		AgentSettingsSchema.parse({ reasoningEffort: "made-up" }),
	).toThrow();
});

it("retains per-step effort and custom variant in saved definitions", () => {
	const workflows = structuredClone(defaultWorkflows);
	workflows.find((item) => item.id === "factory-pipeline")!.steps[0]!.runner =
		"codex";
	workflows.find((item) => item.id === "factory-pipeline")!
		.steps[0]!.reasoningEffort = "high";
	workflows.find((item) => item.id === "factory-pipeline")!.steps[2]!.runner =
		"opencode";
	workflows.find((item) => item.id === "factory-pipeline")!
		.steps[2]!.modelVariant = "custom-review";
	const saved = validateWorkflows(workflows);
	expect(
		saved.find((item) => item.id === "factory-pipeline")!.steps[0]!,
	).toMatchObject({ runner: "codex", reasoningEffort: "high" });
	expect(
		saved.find((item) => item.id === "factory-pipeline")!.steps[2]!,
	).toMatchObject({ runner: "opencode", modelVariant: "custom-review" });
});

it("rejects a saved role variant belonging to another provider", () => {
	const definitions = structuredClone(defaultWorkflows);
	const role = definitions.find((item) => item.id === "factory-pipeline")!
		.steps[0]!;
	role.runner = "codex";
	role.modelVariant = "high";
	expect(() => validateWorkflows(definitions)).toThrow(
		"Model variants require OpenCode",
	);
});
