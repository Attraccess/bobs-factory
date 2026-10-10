// Pure view model for the TUI: Today sections, labels, step strip and the
// conversation built from a run's activity page. No I/O.
import {
	type Attention,
	active,
	attention,
	finished,
	type RunSummary,
	settleReason,
	workingLabel,
} from "bobs-factory-edge-worker";

export interface WorkflowStep {
	id: string;
	name?: string;
	type?: string;
	workflow?: string;
	groups?: WorkflowStep[][];
}
export interface LaunchField {
	name: string;
	label: string;
	type?: "text" | "textarea" | "select";
	required?: boolean;
	placeholder?: string;
	description?: string;
	defaultValue?: string;
	options?: { value: string; label: string }[];
}
export interface Workflow {
	enabled?: boolean;
	unavailable?: string[];
	id: string;
	name: string;
	steps?: WorkflowStep[];
	allowedTriggers?: string[];
	launchFields?: LaunchField[];
}
export interface FactoryConfig {
	configRevision?: string;
	repositories: { id: string; name: string; repositoryIds?: string[] }[];
	workflows: Workflow[];
	defaultWorkflow?: string;
	defaultRunner?: string;
	capacity?: {
		limit?: number;
		active?: number;
		queued?: number;
		stopping?: number;
	};
}
export interface RunItem extends RunSummary {
	id: string;
	title: string;
	repositoryId?: string;
	workflow?: string;
	step?: string;
	error?: string;
	workflowBlock?: { reason: string };
	reviewGate?: { id?: string; headSha?: string; url?: string; status?: string };
	titleGeneration?: { status?: string };
}
export interface Recommendation {
	questionIndex: number;
	answer: string;
	reason?: string;
}
export interface RunDetail extends Omit<RunItem, "workflow"> {
	workflow?: Workflow;
	runner?: string;
	model?: string;
	history?: { step: string; at: string }[];
	questions?: string[];
	questionRecommendations?: Recommendation[];
	questionBatchId?: string;
	iterationLimit?: { step: string; visits: number; limit: number };
	resumeEligible?: boolean;
	chat?: {
		enabled?: boolean;
		available?: boolean;
		reason?: string;
		mode?: string;
	};
	chatMessages?: { id?: string; text: string; at?: string; step?: string }[];
	workspace?: string;
}
export interface ActivityPage {
	entries?: Record<string, any>[];
	events?: Record<string, any>[];
	hasOlder?: boolean;
}

export type Tone =
	| "question"
	| "stuck"
	| "review"
	| "working"
	| "muted"
	| "text";

export function today(runs: RunItem[]) {
	const rank: Record<Attention, number> = { question: 0, stuck: 1, review: 2 };
	const time = (run: RunItem) => run.updatedAt ?? run.createdAt;
	const settled = runs.filter((run) => settleReason(run, runs));
	const open = runs.filter((run) => !settleReason(run, runs));
	const needsYou = open
		.filter((run) => attention(run))
		.sort(
			(a, b) =>
				rank[attention(a)!] - rank[attention(b)!] ||
				time(b).localeCompare(time(a)),
		);
	// Kept-open finished runs have no attention but must stay visible.
	const working = open
		.filter((run) => !attention(run))
		.sort(
			(a, b) =>
				Number(finished(a.status)) - Number(finished(b.status)) ||
				b.createdAt.localeCompare(a.createdAt),
		);
	return { needsYou, working, settled };
}

function findStep(
	steps: WorkflowStep[] | undefined,
	id: string,
	workflows: Workflow[],
	seen: string[] = [],
): WorkflowStep | undefined {
	for (const step of steps ?? []) {
		if (step.id === id) return step;
		const nested =
			step.type === "workflow" && step.workflow && !seen.includes(step.workflow)
				? findStep(
						workflows.find((w) => w.id === step.workflow)?.steps,
						id,
						workflows,
						[...seen, step.workflow],
					)
				: undefined;
		const grouped = (step.groups ?? [])
			.map((group) => findStep(group, id, workflows, seen))
			.find(Boolean);
		if (nested ?? grouped) return nested ?? grouped;
	}
	return undefined;
}

/** Human name for a step key such as "fanout/0/implement". */
export function stepName(
	key: string | undefined,
	workflow: Workflow | undefined,
	workflows: Workflow[] = [],
) {
	if (!key) return undefined;
	const id = key.split("/").at(-1)!;
	return findStep(workflow?.steps, id, workflows)?.name ?? id;
}

export function workflowOf(
	run: { workflow?: string | Workflow },
	config?: FactoryConfig,
): Workflow | undefined {
	if (typeof run.workflow === "object") return run.workflow;
	return config?.workflows.find((w) => w.id === run.workflow);
}

export function stateLabel(
	run: RunItem,
	config?: FactoryConfig,
): { text: string; tone: Tone } {
	const kind = attention(run);
	if (kind === "question") return { text: "needs answer", tone: "question" };
	if (kind === "stuck")
		return {
			text: run.status === "interrupted" ? "interrupted" : "stuck",
			tone: "stuck",
		};
	if (kind === "review")
		return run.reviewGate?.status === "pending"
			? { text: "ready for review", tone: "review" }
			: { text: "finished", tone: "review" };
	if (active(run.status)) {
		const label = workingLabel(run);
		if (label !== "Working")
			return { text: label.toLowerCase(), tone: "muted" };
		return {
			text:
				stepName(run.step, workflowOf(run, config), config?.workflows) ??
				"working",
			tone: "working",
		};
	}
	return { text: run.status, tone: "muted" };
}

export function repositoryName(config: FactoryConfig | undefined, id?: string) {
	return config?.repositories.find((repo) => repo.id === id)?.name ?? id ?? "";
}

export type StepState = "done" | "active" | "waiting" | "failed" | "pending";

/** Top-level steps of the run's recipe with progress from its history. */
export function stepStrip(
	run: RunDetail,
): { name: string; state: StepState }[] {
	const steps = run.workflow?.steps ?? [];
	const top = (key?: string) => key?.split("/")[0];
	const visited = new Set((run.history ?? []).map((item) => top(item.step)));
	const current = top(run.step);
	const done = ["completed", "complete"].includes(run.status);
	return steps.map((step) => {
		const name = step.name ?? step.id;
		if (done) return { name, state: "done" };
		if (step.id === current)
			return {
				name,
				state:
					run.status === "waiting"
						? "waiting"
						: ["failed", "error", "interrupted"].includes(run.status)
							? "failed"
							: active(run.status)
								? "active"
								: "pending",
			};
		return { name, state: visited.has(step.id) ? "done" : "pending" };
	});
}

export type LineKind =
	| "step"
	| "agent"
	| "response"
	| "tool"
	| "you"
	| "system"
	| "error";
export interface ConversationLine {
	kind: LineKind;
	text: string;
	detail?: string;
	status?: "running" | "ok" | "error";
	at: string;
}

const text = (value: unknown): string => {
	if (typeof value === "string") return value;
	if (Array.isArray(value))
		return value
			.map((part) =>
				typeof part === "string" ? part : (part?.text ?? part?.content ?? ""),
			)
			.filter(Boolean)
			.join("\n");
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		if (typeof record.text === "string") return record.text;
		return JSON.stringify(value);
	}
	return value === undefined || value === null ? "" : String(value);
};

const parse = (value: unknown) => {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
};

/** Tool name plus its most telling argument, e.g. "Bash" / "pnpm test". */
export function toolSummary(name: string, input: unknown) {
	const label = name.startsWith("mcp__")
		? name.slice(5).split("__").join(" · ")
		: name;
	const args = (parse(input) ?? {}) as Record<string, unknown>;
	const key = [
		"command",
		"file_path",
		"path",
		"pattern",
		"url",
		"query",
		"description",
		"prompt",
	].find((name) => typeof args[name] === "string" && args[name]);
	const detail = key
		? String(args[key])
		: typeof args === "object" && Object.keys(args).length
			? JSON.stringify(args)
			: typeof args === "string"
				? args
				: "";
	return { label, detail: detail.replace(/\s+/g, " ").trim() };
}

const stamp = (entry: Record<string, any>, fallback: string) =>
	new Date(
		entry.metadata?.timestamp ??
			entry.timestamp ??
			entry.createdAt ??
			entry.at ??
			fallback,
	).toISOString();

/** Builds the readable conversation from an activity page and saved chat messages. */
export function conversation(
	page: ActivityPage,
	chat: RunDetail["chatMessages"] = [],
	createdAt = new Date(0).toISOString(),
): ConversationLine[] {
	const lines: (ConversationLine & { step?: string })[] = [];
	const tools = new Map<string, ConversationLine>();
	const add = (entry: Record<string, any>, at: string, step?: string) => {
		const metadata = entry.metadata ?? {};
		const blocks = entry.message?.content;
		if (Array.isArray(blocks)) {
			for (const block of blocks) {
				if (block.type === "tool_use")
					add(
						{
							type: "assistant",
							metadata: {
								toolUseId: block.id,
								toolName: block.name,
								toolInput: block.input,
							},
						},
						at,
						step,
					);
				else if (block.type === "tool_result")
					add(
						{
							type: "user",
							content: text(block.content),
							metadata: {
								toolUseId: block.tool_use_id,
								toolResultError: block.is_error,
							},
						},
						at,
						step,
					);
				else if (block.type === "text")
					add({ type: entry.type, content: block.text }, at, step);
			}
			return;
		}
		if (metadata.toolUseId && entry.type === "assistant") {
			const { label, detail } = toolSummary(
				metadata.toolName ?? "Tool",
				metadata.toolInput ?? entry.content,
			);
			const line: ConversationLine & { step?: string } = {
				kind: "tool",
				text: label,
				detail,
				status: "running",
				at,
				step,
			};
			tools.set(metadata.toolUseId, line);
			lines.push(line);
			return;
		}
		if (metadata.toolUseId && entry.type === "user") {
			const line = tools.get(metadata.toolUseId);
			const status = metadata.toolResultError ? "error" : "ok";
			if (line) line.status = status;
			else lines.push({ kind: "tool", text: "Tool result", status, at, step });
			return;
		}
		const body = text(
			entry.content ?? entry.result ?? entry.errors ?? "",
		).trim();
		const error = Boolean(entry.is_error || metadata.isError);
		if (!body && !error) return;
		const kind: LineKind = error
			? "error"
			: entry.type === "result"
				? "response"
				: entry.type === "assistant"
					? "agent"
					: entry.type === "user"
						? "you"
						: "system";
		const previous = lines.at(-1);
		// Results usually repeat the final assistant message.
		if (
			kind === "response" &&
			previous?.kind === "agent" &&
			previous.text === body
		) {
			previous.kind = "response";
			return;
		}
		lines.push({ kind, text: body || "Agent failed", at, step });
	};
	for (const entry of page.entries ?? [])
		add(entry, stamp(entry, createdAt), entry.activityStep);
	for (const event of page.events ?? []) {
		if (event.source === "agent") continue;
		const message = text(event.message).trim();
		if (message)
			lines.push({
				kind: "system",
				text: message,
				at: stamp(event, createdAt),
				step: event.step,
			});
	}
	const prompts = new Set(
		lines.filter((line) => line.kind === "you").map((line) => line.text),
	);
	for (const message of chat)
		if (!prompts.has(message.text))
			lines.push({
				kind: "you",
				text: message.text,
				at: stamp(message, createdAt),
			});
	lines.sort((a, b) => a.at.localeCompare(b.at));
	const output: ConversationLine[] = [];
	let step: string | undefined;
	for (const { step: lineStep, ...line } of lines) {
		if (
			lineStep &&
			lineStep !== step &&
			!["run", "prepare"].includes(lineStep)
		) {
			step = lineStep;
			output.push({ kind: "step", text: lineStep, at: line.at });
		}
		output.push(line);
	}
	return output;
}

export function ago(at: string | undefined, now = Date.now()) {
	if (!at) return "";
	const seconds = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
	if (seconds < 60) return "just now";
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
	return `${Math.floor(seconds / 86400)}d ago`;
}

/** Recipes the composer may start, with the saved default first when allowed. */
export function launchableWorkflows(config: FactoryConfig) {
	const manual = config.workflows.filter(
		(workflow) =>
			workflow.enabled !== false &&
			!workflow.unavailable?.length &&
			(workflow.allowedTriggers ?? ["manual"]).includes("manual"),
	);
	return [
		...manual.filter((w) => w.id === config.defaultWorkflow),
		...manual.filter((w) => w.id !== config.defaultWorkflow),
	];
}

export const RUNNERS = ["claude", "codex", "gemini", "cursor", "opencode"];
