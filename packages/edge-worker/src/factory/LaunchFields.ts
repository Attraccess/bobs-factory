import { z } from "zod";
import { agentSettings } from "./AgentSettings.js";
import { TakeoverSourceSchema } from "./Takeover.js";
import type { Workflow } from "./Workflow.js";

export const LaunchFieldSchema = z
	.object({
		name: z
			.string()
			.regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/)
			.max(80),
		label: z.string().trim().min(1).max(120),
		type: z.enum(["text", "textarea", "select"]).default("text"),
		required: z.boolean().default(false),
		placeholder: z.string().max(1000).optional(),
		description: z.string().max(1000).optional(),
		defaultValue: z.string().max(100000).optional(),
		options: z
			.array(
				z.object({
					value: z.string().min(1).max(1000),
					label: z.string().min(1).max(120),
				}),
			)
			.max(50)
			.default([]),
	})
	.refine(
		(field) => field.type !== "select" || field.options.length > 0,
		"Choice fields need options",
	);
export type LaunchField = z.infer<typeof LaunchFieldSchema>;
export const standardLaunchFields = [
	{
		name: "title",
		label: "Title",
		required: true,
		placeholder: "Add a customer dashboard",
	},
	{
		name: "prompt",
		label: "What should we build?",
		type: "textarea",
		required: true,
		placeholder: "Describe the task, requirements and any useful context…",
	},
];
export const takeoverLaunchFields = [
	{
		name: "source",
		label: "Existing PR or ticket",
		required: true,
		placeholder: "Linear ticket ID/URL or GitHub PR URL",
		description:
			"Continue the work described by this source. Existing PRs become draft during factory review.",
	},
	{
		name: "prompt",
		label: "Additional instructions",
		type: "textarea",
		placeholder: "Anything to add beyond the existing ticket or PR?",
	},
];
export function getLaunchFields(
	workflow: Pick<Workflow, "id" | "launchFields" | "internal">,
): LaunchField[] {
	return (
		workflow.launchFields ??
		z
			.array(LaunchFieldSchema)
			.parse(
				workflow.internal
					? []
					: workflow.id === "takeover"
						? takeoverLaunchFields
						: standardLaunchFields,
			)
	);
}
export const LaunchRequestSchema = z.object({
	title: z.string().trim().max(300).optional(),
	prompt: z.string().trim().max(100000).optional(),
	source: z.string().trim().max(1000).optional(),
	inputs: z.record(z.string(), z.string().max(100000)).default({}),
	repositoryId: z.string().min(1),
	workflow: z.string().min(1),
	...agentSettings,
});
export type LaunchRequest = z.infer<typeof LaunchRequestSchema>;
export function resolveLaunchRequest(
	workflow: Workflow,
	request: LaunchRequest,
) {
	const values = { ...request.inputs };
	const schema: Record<string, z.ZodType<string>> = {};
	for (const field of getLaunchFields(workflow)) {
		const legacy = ["title", "prompt", "source"].includes(field.name)
			? request[field.name as "title" | "prompt" | "source"]
			: undefined;
		values[field.name] = Object.hasOwn(values, field.name)
			? values[field.name]!
			: (legacy ?? field.defaultValue ?? "");
		let value = z
			.string()
			.trim()
			.max(
				field.name === "title" ? 300 : field.name === "source" ? 1000 : 100000,
			);
		if (field.required) value = value.min(1, `${field.label} is required`);
		schema[field.name] =
			field.type === "select"
				? value.refine(
						(v) =>
							(!v && !field.required) ||
							field.options.some((option) => option.value === v),
						`Choose a valid ${field.label}`,
					)
				: value;
	}
	const inputs = z.object(schema).strict().parse(values) as Record<
		string,
		string
	>;
	const source = inputs.source || request.source || undefined;
	if (workflow.id === "takeover") TakeoverSourceSchema.parse(source);
	const providedTitle = inputs.title || request.title;
	return {
		...request,
		inputs,
		source,
		title:
			providedTitle ||
			(source ? `${workflow.name}: ${source}` : workflow.name).slice(0, 300),
		titleProvided: Boolean(providedTitle),
		prompt: inputs.prompt ?? request.prompt ?? "",
	};
}
export type ResolvedLaunchRequest = ReturnType<typeof resolveLaunchRequest>;
