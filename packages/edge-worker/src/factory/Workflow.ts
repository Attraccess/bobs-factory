import { z } from "zod";
import { agentSettings, resolveAgentSettings } from "./AgentSettings.js";

import { LaunchFieldSchema } from "./LaunchFields.js";

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
	...agentSettings,
	json: z.boolean().default(true),
	askQuestions: z.boolean().default(false),
});
export type AgentStep = z.infer<typeof AgentStepSchema>;
export interface WorkflowStep {
	id: string;
	name: string;
	type: "agent" | "script" | "tool" | "fanout" | "workflow";
	next?: string;
	branches: { when: { path: string; equals?: unknown }; next: string }[];
	maxVisits: number;
	prompt?: string;
	inputs?: string[];
	runner?: AgentStep["runner"];
	model?: string;
	reasoningEffort?: AgentStep["reasoningEffort"];
	modelVariant?: string;
	json?: boolean;
	askQuestions?: boolean;
	script?: string;
	tool?: string;
	args?: string[];
	arguments?: Record<string, unknown>;
	groups?: WorkflowStep[][];
	workflow?: string;
}
export const StepSchema: z.ZodType<WorkflowStep> = z.lazy(() =>
	z.discriminatedUnion("type", [
		AgentStepSchema,
		z.object({ ...base, type: z.literal("workflow"), workflow: id }),
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
	internal: z.boolean().optional(),
	launchFields: z.array(LaunchFieldSchema).max(20).optional(),
});
export type Workflow = z.infer<typeof WorkflowSchema>;

export function validateWorkflows(value: unknown): Workflow[] {
	const workflows = z.array(WorkflowSchema).min(1).max(50).parse(value);
	const ids = new Set<string>();
	for (const workflow of workflows) {
		if (ids.has(workflow.id))
			throw new Error(`Duplicate workflow: ${workflow.id}`);
		ids.add(workflow.id);
		const fields = workflow.launchFields ?? [];
		if (new Set(fields.map((field) => field.name)).size !== fields.length)
			throw new Error("Duplicate launch field names");
		for (const field of fields) {
			if (
				[
					"repositoryId",
					"workflow",
					"runner",
					"model",
					"reasoningEffort",
					"modelVariant",
					"inputs",
					"constructor",
					"prototype",
				].includes(field.name)
			)
				throw new Error(`Reserved launch field name: ${field.name}`);
			if (
				field.type === "select" &&
				new Set(field.options.map((option) => option.value)).size !==
					field.options.length
			)
				throw new Error("Duplicate launch choice values");
			if (
				field.defaultValue &&
				field.type === "select" &&
				!field.options.some((option) => option.value === field.defaultValue)
			)
				throw new Error("Invalid launch field default choice");
		}
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
				if (step.type === "agent" && step.runner)
					resolveAgentSettings(step.runner, step);
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
	if (!ids.has("simple") || !ids.has("factory") || !ids.has("takeover"))
		throw new Error("Keep the simple, factory and takeover defaults");
	const byId = new Map(workflows.map((workflow) => [workflow.id, workflow]));
	const checkCalls = (
		steps: WorkflowStep[],
		ancestors: string[],
		parallel = false,
	): void => {
		for (const step of steps) {
			if (parallel && step.askQuestions)
				throw new Error("Human checkpoints belong outside fanout branches");
			if (step.type === "workflow") {
				const target = byId.get(step.workflow!);
				if (!target || target.id === "simple")
					throw new Error(`Unknown or uncallable workflow: ${step.workflow}`);
				if (ancestors.includes(target.id))
					throw new Error(
						`Recursive workflow call: ${[...ancestors, target.id].join(" → ")}`,
					);
				if (ancestors.length >= 10)
					throw new Error("Workflow nesting exceeds 10 levels");
				checkCalls(target.steps, [...ancestors, target.id], parallel);
			}
			for (const group of step.groups ?? []) checkCalls(group, ancestors, true);
		}
	};
	for (const workflow of workflows) checkCalls(workflow.steps, [workflow.id]);
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
