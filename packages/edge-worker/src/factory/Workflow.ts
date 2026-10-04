import { z } from "zod";

const id = z
	.string()
	.regex(/^[a-zA-Z0-9_-]+$/)
	.max(80);
const condition = z.object({ path: z.string().min(1), equals: z.unknown() });
const base = {
	id,
	name: z.string().min(1),
	next: id.optional(),
	branches: z.array(z.object({ when: condition, next: id })).default([]),
	maxVisits: z.number().int().min(1).max(100).default(8),
};
export const AgentStepSchema = z.object({
	...base,
	type: z.literal("agent"),
	prompt: z.string().min(1),
	inputs: z.array(z.string()).optional(),
	runner: z
		.enum(["claude", "codex", "gemini", "cursor", "opencode"])
		.optional(),
	model: z.string().min(1).optional(),
	json: z.boolean().default(true),
	askQuestions: z.boolean().default(false),
});
export type AgentStep = z.infer<typeof AgentStepSchema>;
export interface WorkflowStep {
	id: string;
	name: string;
	type: "agent" | "script" | "tool" | "fanout";
	next?: string;
	branches: { when: { path: string; equals?: unknown }; next: string }[];
	maxVisits: number;
	prompt?: string;
	inputs?: string[];
	runner?: AgentStep["runner"];
	model?: string;
	json?: boolean;
	askQuestions?: boolean;
	script?: string;
	tool?: string;
	args?: string[];
	arguments?: Record<string, unknown>;
	groups?: WorkflowStep[][];
}
export const StepSchema: z.ZodType<WorkflowStep> = z.lazy(() =>
	z.discriminatedUnion("type", [
		AgentStepSchema,
		z.object({ ...base, type: z.literal("script"), script: z.string().min(1) }),
		z.object({
			...base,
			type: z.literal("tool"),
			tool: z.string().min(1),
			args: z.array(z.string()).default([]),
			arguments: z.record(z.string(), z.unknown()).optional(),
		}),
		z.object({
			...base,
			type: z.literal("fanout"),
			groups: z.array(z.array(StepSchema).min(1)).min(1).max(8),
		}),
	]),
);
export const WorkflowSchema = z.object({
	id,
	name: z.string().min(1),
	description: z.string().default(""),
	labels: z.array(z.string().min(1)).default([]),
	steps: z.array(StepSchema).max(100),
});
export type Workflow = z.infer<typeof WorkflowSchema>;

export function validateWorkflows(value: unknown): Workflow[] {
	const workflows = z.array(WorkflowSchema).min(1).max(50).parse(value);
	const ids = new Set<string>();
	for (const workflow of workflows) {
		if (ids.has(workflow.id))
			throw new Error(`Duplicate workflow: ${workflow.id}`);
		ids.add(workflow.id);
		if (workflow.id === "simple" && workflow.steps.length)
			throw new Error(
				"simple uses Cyrus's existing execution path; clone it under another ID to customize",
			);
		if (workflow.id !== "simple" && !workflow.steps.length)
			throw new Error(`Workflow ${workflow.id} needs steps`);
		const check = (steps: WorkflowStep[]) => {
			const names = new Set(steps.map((step) => step.id));
			if (names.size !== steps.length) throw new Error("Duplicate step IDs");
			for (const step of steps) {
				for (const target of [
					step.next,
					...step.branches.map((branch) => branch.next),
				]) {
					if (target && target !== "end" && !names.has(target))
						throw new Error(`Unknown step: ${target}`);
				}
				if (step.id === "end") throw new Error("end is reserved");
				for (const group of step.groups ?? []) check(group);
			}
		};
		check(workflow.steps);
	}
	if (!ids.has("simple") || !ids.has("factory"))
		throw new Error("Keep the simple and factory defaults");
	return workflows;
}

export function readPath(value: unknown, path: string): unknown {
	return path
		.split(".")
		.reduce<unknown>(
			(current, key) =>
				current && typeof current === "object" && Object.hasOwn(current, key)
					? (current as Record<string, unknown>)[key]
					: undefined,
			value,
		);
}
