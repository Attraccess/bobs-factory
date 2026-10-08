import { passiveTools } from "./CapacityPolicy.js";

export { isComputeIntensive, passiveTools } from "./CapacityPolicy.js";

import type { WorkflowTrigger } from "bobs-factory-core";
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
	qaContract: z.literal("qa-v1").optional(),
	maxVisits: z.number().int().min(1).max(100).default(8),
};
export const AgentStepSchema = z.object({
	...base,
	type: z.literal("agent"),
	computeIntensive: z.never().optional(),
	prompt: z.string().min(1),
	inputs: z.array(z.string()).optional(),
	...agentSettings,
	json: z.boolean().default(true),
	askQuestions: z.boolean().default(false),
	chat: z.boolean().optional(),
});
export type AgentStep = z.infer<typeof AgentStepSchema>;
export interface WorkflowStep {
	id: string;
	name: string;
	type: "agent" | "script" | "tool" | "fanout" | "workflow";
	next?: string;
	branches: { when: { path: string; equals?: unknown }; next: string }[];
	maxVisits: number;
	qaContract?: "qa-v1";
	prompt?: string;
	inputs?: string[];
	runner?: AgentStep["runner"];
	model?: string;
	reasoningEffort?: AgentStep["reasoningEffort"];
	modelVariant?: string;
	serviceTier?: AgentStep["serviceTier"];
	json?: boolean;
	askQuestions?: boolean;
	chat?: boolean;
	computeIntensive?: boolean;
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
		z.object({
			...base,
			type: z.literal("workflow"),
			workflow: id,
			computeIntensive: z.never().optional(),
		}),
		z.object({
			...base,
			type: z.literal("script"),
			script: z.string().min(1),
			computeIntensive: z.boolean().optional(),
		}),
		z.object({
			...base,
			type: z.literal("tool"),
			tool: z.string().min(1),
			computeIntensive: z.boolean().optional(),
			args: z.array(z.string()).default([]),
			arguments: z.record(z.string(), z.unknown()).optional(),
		}),
		z.object({
			...base,
			type: z.literal("fanout"),
			computeIntensive: z.never().optional(),
			groups: z.array(z.array(StepSchema).min(1)).min(1).max(8),
		}),
	]),
);
export const WorkflowSchema = z
	.object({
		id,
		name: z.string().min(1),
		icon: z.string().max(32).optional(),
		description: z.string().default(""),
		labels: z.array(z.string().min(1)).default([]),
		steps: z.array(StepSchema).max(100),
		internal: z.boolean().optional(),
		chat: z.boolean().optional(),
		allowedTriggers: z
			.array(z.enum(["workflow", "manual", "ticket-assignment"]))
			.refine(
				(values) => new Set(values).size === values.length,
				"Duplicate allowed triggers",
			)
			.optional(),
		launchFields: z.array(LaunchFieldSchema).max(20).optional(),
	})
	.transform((workflow) => ({
		...workflow,
		allowedTriggers: workflow.allowedTriggers ?? legacyTriggers(workflow),
	}));
export type Workflow = z.infer<typeof WorkflowSchema>;

function legacyTriggers(workflow: {
	id: string;
	internal?: boolean;
}): WorkflowTrigger[] {
	return workflow.id === "simple"
		? ["manual", "ticket-assignment"]
		: workflow.internal
			? ["workflow"]
			: ["workflow", "manual", "ticket-assignment"];
}

export function supportsTrigger(
	workflow: Workflow,
	trigger: WorkflowTrigger,
): boolean {
	return (
		(workflow.allowedTriggers ?? legacyTriggers(workflow)).includes(trigger) &&
		!(workflow.id === "simple" && trigger === "workflow")
	);
}

export function requireTrigger(
	workflow: Workflow,
	trigger: WorkflowTrigger,
): void {
	if (!supportsTrigger(workflow, trigger))
		throw new Error(
			`Workflow "${workflow.name}" (${workflow.id}) does not allow ${trigger} launches. Enable the appropriate permission in Recipes, change the selected workflow/label, or choose an eligible saved default.`,
		);
}

export function validateWorkflows(value: unknown): Workflow[] {
	const workflows = z.array(WorkflowSchema).min(1).max(50).parse(value);
	const ids = new Set<string>();
	for (const workflow of workflows) {
		if (ids.has(workflow.id))
			throw new Error(`Duplicate workflow: ${workflow.id}`);
		ids.add(workflow.id);
		if (
			workflow.id === "simple" &&
			workflow.allowedTriggers.includes("workflow")
		)
			throw new Error(
				"Simple / Bob’s Factory cannot be called by another workflow; clone it under another ID with graph steps to customize.",
			);
		const fields = workflow.launchFields ?? [];
		if (new Set(fields.map((field) => field.name)).size !== fields.length)
			throw new Error("Duplicate launch field names");
		for (const field of fields) {
			if (
				[
					"title",
					"repositoryId",
					"workflow",
					"runner",
					"model",
					"reasoningEffort",
					"modelVariant",
					"serviceTier",
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
				"simple uses Bob’s Factory’s existing execution path; clone it under another ID to customize",
			);
		if (workflow.id !== "simple" && !workflow.steps.length)
			throw new Error(`Workflow ${workflow.id} needs steps`);
		const check = (steps: WorkflowStep[]) => {
			const names = new Set(steps.map((step) => step.id));
			if (names.size !== steps.length) throw new Error("Duplicate step IDs");
			for (const step of steps) {
				if (step.computeIntensive && passiveTools.includes(step.tool ?? ""))
					throw new Error(
						`Passive wait ${step.tool} cannot consume execution capacity`,
					);
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
			if (parallel && (step.askQuestions || step.tool === "human-review"))
				throw new Error("Human checkpoints belong outside fanout branches");
			if (step.type === "workflow") {
				const target = byId.get(step.workflow!);
				if (!target || target.id === "simple")
					throw new Error(`Unknown or uncallable workflow: ${step.workflow}`);
				requireTrigger(target, "workflow");
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

export const workflowTriggerInstructions =
	"Current workflow launch behavior (capability reference): Newly authored technical/mixed review guides require whole-PR scope classification, 3–6 system-map lanes and chapter part links; only evidenced purely visual scope is exempt. Saved older guides remain readable. The review reader keeps item commenting throughout and collects feedback, additional feedback and page-level PR/diff actions on Decide, reached through the sticky feedback count. The Factory dashboard requires passkey sessions on every address, including localhost. An empty authentication store shows operator-authorized first-passkey setup; provider webhooks and OAuth use their separate listener. Refinement questions can include generated questionRecommendations with zero-based questionIndex, answer and evidence-based reason. The dashboard selects suggestions by default and provides a separate blank Custom answer field. Recommendations require explicit Send answers submission or a ticket reply; they never automatically authorize work. Legacy questions without metadata use blank text fields. Factory manual launches accept an originating Linear or Taskbot ticket URL as the prompt or explicit ticket source. The runtime fetches complete ticket context, retains verified tracker identity through roles and follow-ups, and owns lifecycle comments and PR links. Coding tickets stay nonterminal during work, In Review awaiting human/provider action, and Done only after provider-confirmed merge. Ticket synchronization failures remain visible in run activity and ticketSync receipts; retry only tracking through POST /api/runs/:id/ticket-sync after restoring access or reassessing conflicts. Simple retains its native tracking lifecycle. Factory supports opt-in Web Push through Notifications for new questions, review revisions, human-only blockers, failures needing help and successful completions. Enable and test each browser device explicitly; remote disable never auto-enables. Rephrasing a pending decision does not create a new question notification. VAPID subscriptions and consumed transition receipts survive restart. Only fresh transitions are attempted, with TTL zero and no replay after enablement, outage or recovery; provider acceptance does not prove display. Notification text is minimal; clicks refresh protected run/review state before actions. Configure BOBS_FACTORY_FACTORY_PUSH_SUBJECT and, for the trusted HTTPS proxy, the exact BOBS_FACTORY_FACTORY_ORIGIN; physical-device background delivery remains unverified. Workflow selection is separate from repository routing. Stock workflow labels are workflow:factory (or factory), workflow:takeover (or takeover), and workflow:simple; operators can customize labels in Recipes. New launches select an explicit manual UI/API workflow choice, then [workflow=<id>] in the original triggering comment, then the issue description, then the first matching workflow in configured label order, then the single saved default. Escaped brackets are supported. Quoted text and code examples are ignored; repeated identical selectors are valid, but malformed or conflicting selectors in the winning source reject without fallback. Higher-priority sources override lower-source conflicts. New mention-created sessions on an active issue reject temporarily pending #36; reply to the existing session for steering or answers. The selected workflow must allow ticket-assignment for assignments or @mentions, manual for new UI/API or follow-up launches, and workflow for nested calls. A disallowed selection is rejected without fallback; enable its permission in Recipes, change the selection/label, or choose an eligible default. Existing runs retain their accepted definitions; replies and resume do not select a new workflow. Use these supported launch methods when starting work. When the task requests changes to this product, evaluate the proposed behavior against the task's requirements and accepted decisions, within your assigned role. Missing current capabilities are implementation work, not a conflict with these instructions; update the capability reference alongside an implemented behavior change. Explicit task restrictions such as planning-only or deferred implementation still apply.";

export const capacityInstructions =
	"Instance capacity bounds scheduled agent executions and intensive workflow steps. Each Factory home has its own pool, with four slots by default. Tool calls and commands within an admitted agent share its slot; temporary F1 instances with separate homes have independent pools. Do not launch harness subagents or independent background heavy work inside a managed agent turn. Schedule heavy children as nested workflow steps or fanout branches so each receives capacity. Ask questions in your final response and finish the turn; native AskUserQuestion is disabled because its callback cannot safely suspend all parallel execution. Parent orchestration, human waits, and passive CI waits consume no slots.";
