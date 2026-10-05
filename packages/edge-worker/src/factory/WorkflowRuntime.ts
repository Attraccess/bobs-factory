import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { WorkflowTrigger, WorkflowTriggerOrigin } from "cyrus-core";
import { activityMarkers } from "./ActivityPage.js";
import type { AgentSettings } from "./AgentSettings.js";
import { defaultWorkflows, upgradeWorkflows } from "./defaultWorkflows.js";
import type { RoleProgress, RoleRevision } from "./Incremental.js";
import {
	readPath,
	requireTrigger,
	validateWorkflows,
	type Workflow,
	WorkflowSchema,
	type WorkflowStep,
} from "./Workflow.js";

export type RunStatus =
	| "running"
	| "waiting"
	| "completed"
	| "failed"
	| "stopped"
	| "interrupted";
export interface RunEvent {
	call?: WorkflowCall;
	sequence?: number;
	source?: "agent" | "workflow";
	at: string;
	step: string;
	message: string;
}
export interface WorkflowCall {
	type: "workflow";
	callerWorkflowId: string;
	step: string;
	key: string;
	workflowId: string;
}
export interface AgentCheckpoint {
	runner: NonNullable<WorkflowStep["runner"]>;
	sessionId: string;
	result?: { output: unknown; revision: RoleRevision };
}
export interface GraphCheckpoint {
	current: string;
	visits: Record<string, number>;
	additionalVisits?: Record<string, number>;
	active?: {
		phase: "executing" | "result" | "waiting" | "answered";
		agent?: AgentCheckpoint;
		children?: GraphCheckpoint[];
		call?: WorkflowCall;
	};
	// Only fanout branches own separate outputs; nested workflows share their parent's.
	outputs?: Record<string, unknown>;
}
export interface HumanDecision {
	reviewId: string;
	headSha: string;
	decision: "approve" | "reject";
	feedback?: string;
	at: string;
}
export interface ReviewGate {
	id: string;
	headSha: string;
	url: string;
	status: "pending" | "approve" | "reject";
}
export interface RunViewState {
	settledAt?: string;
	keptOpen?: boolean;
	seenAt?: string;
}
export interface FactoryRun {
	triggerOrigin?: WorkflowTriggerOrigin;
	workflowCalls?: { call: WorkflowCall; at: string }[];
	id: string;
	title: string;
	repositoryId: string;
	workflow: Workflow;
	workflowDefinitions?: Workflow[];
	source?: string;
	status: RunStatus;
	createdAt: string;
	updatedAt: string;
	workspace: string;
	input: string;
	launchInputs?: Record<string, string>;
	runner?: string;
	model?: string;
	reasoningEffort?: AgentSettings["reasoningEffort"];
	modelVariant?: string;
	serviceTier?: AgentSettings["serviceTier"];
	issueId?: string;
	workspaceId?: string;
	step?: string;
	checkpoint?: GraphCheckpoint;
	simplePrompt?: string;
	simpleExecution?: {
		userPrompt: string;
		systemPrompt?: string;
		runner: NonNullable<WorkflowStep["runner"]>;
		agent?: AgentCheckpoint;
	};
	launchRequest?: import("./LaunchFields.js").ResolvedLaunchRequest;
	setupComplete?: boolean;
	sessionSnapshot?: import("cyrus-core").SerializedCyrusAgentSession;
	reviewGate?: ReviewGate;
	humanDecisions?: HumanDecision[];
	roleRevisions?: Record<string, RoleRevision>;
	outputs: Record<string, unknown>;
	history: { step: string; output: unknown; at: string; call?: WorkflowCall }[];
	answers: { questions: string[]; answer: string; at: string }[];
	questions: string[];
	events: RunEvent[];
	activitySteps?: { at: string; step: string }[];
	iterationLimit?: { step: string; visits: number; limit: number };
	error?: string;
}
export interface ChatMessage {
	id: string;
	text: string;
	at: string;
	step: string;
}
export interface ExecutionContext {
	stepKey?: string;
	chat?: boolean;
	progress?: RoleProgress;
	run: FactoryRun;
	step: WorkflowStep;
	input: unknown;
	outputs?: Record<string, unknown>;
	signal: AbortSignal;
	log: (message: string, source?: RunEvent["source"]) => void;
	evidenceDir: string;
	resumeAgent?: AgentCheckpoint;
	checkpointAgent?: (agent: AgentCheckpoint) => void;
}
export interface RuntimeHooks {
	agent(context: ExecutionContext): Promise<unknown>;
	script(context: ExecutionContext): Promise<unknown>;
	tool(context: ExecutionContext): Promise<unknown>;
	question?(run: FactoryRun): Promise<void>;
	simple?(run: FactoryRun, signal: AbortSignal): Promise<void>;
	prepare?(run: FactoryRun, signal: AbortSignal): Promise<void>;
}

export class WorkflowRuntime {
	readonly runs = new Map<string, FactoryRun>();
	private listeners = new Set<
		(change: { id?: string; config?: boolean }) => void
	>();
	subscribe(
		listener: (change: { id?: string; config?: boolean }) => void,
	): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	private changed(change: { id?: string; config?: boolean }): void {
		for (const listener of this.listeners) listener(change);
	}
	private controllers = new Map<string, AbortController>();
	private pendingAnswers = new Map<
		string,
		{ resolve: () => void; reject: (error: Error) => void }
	>();
	private workflows: Workflow[];
	private executions = new Map<string, Promise<void>>();
	private pendingActivitySaves = new Map<
		string,
		ReturnType<typeof setTimeout>
	>();
	private shuttingDown = false;
	private defaultWorkflow = "simple";
	private viewStates: Record<string, RunViewState> = {};
	private chats = new Map<string, ChatMessage[]>();
	readonly directory: string;

	constructor(
		home: string,
		private hooks: RuntimeHooks,
	) {
		this.directory = join(home, "factory");
		mkdirSync(join(this.directory, "runs"), { recursive: true });
		const views = join(this.directory, "views.json");
		if (existsSync(views))
			this.viewStates = JSON.parse(readFileSync(views, "utf8"));
		const config = join(this.directory, "workflows.json");
		const stored = existsSync(config)
			? JSON.parse(readFileSync(config, "utf8"))
			: defaultWorkflows;
		this.workflows = validateWorkflows(
			upgradeWorkflows(Array.isArray(stored) ? stored : stored.workflows),
		);
		if (!Array.isArray(stored))
			this.defaultWorkflow = stored.defaultWorkflow ?? "simple";
		this.validateDefault(this.workflows, this.defaultWorkflow);
		const normalized = {
			workflows: this.workflows,
			defaultWorkflow: this.defaultWorkflow,
		};
		if (!isDeepStrictEqual(stored, normalized))
			this.atomicWrite(config, normalized);
		for (const filename of readdirSync(join(this.directory, "runs"))) {
			if (!filename.endsWith(".json")) continue;
			const run: FactoryRun = JSON.parse(
				readFileSync(join(this.directory, "runs", filename), "utf8"),
			);
			run.workflow = WorkflowSchema.parse(run.workflow);

			if (
				run.workflowDefinitions &&
				["running", "waiting", "interrupted", "failed"].includes(run.status)
			) {
				run.workflowDefinitions = validateWorkflows(
					upgradeWorkflows(run.workflowDefinitions),
				);
				const updated = run.workflowDefinitions.find(
					(workflow) => workflow.id === run.workflow.id,
				);
				if (updated) {
					const flat =
						run.workflow.id === "factory" &&
						!run.workflow.steps.some((step) => step.type === "workflow") &&
						run.checkpoint;
					run.workflow = flat
						? {
								...run.workflow,
								steps: structuredClone(
									run.workflowDefinitions.find(
										(item) => item.id === "factory-pipeline",
									)!.steps,
								),
							}
						: structuredClone(updated);
				}
			}
			if (run.workflow.id === "simple" && run.workflow.chat === undefined)
				run.workflow.chat = true;
			this.runs.set(run.id, run);
		}
	}

	chatMessages(id: string): ChatMessage[] {
		let messages = this.chats.get(id);
		if (!messages) {
			const path = join(
				this.directory,
				"chats",
				`${encodeURIComponent(id)}.json`,
			);
			messages = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
			this.chats.set(id, messages!);
		}
		return messages!;
	}
	recordChatMessage(id: string, text: string, step: string): ChatMessage {
		const message = {
			id: randomUUID(),
			text,
			step,
			at: new Date().toISOString(),
		};
		const messages = this.chatMessages(id);
		messages.push(message);
		mkdirSync(join(this.directory, "chats"), { recursive: true });
		this.atomicWrite(
			join(this.directory, "chats", `${encodeURIComponent(id)}.json`),
			messages,
		);
		this.changed({ id });
		return message;
	}
	isExecuting(id: string): boolean {
		return this.controllers.has(id);
	}
	continueSimple(id: string, prompt: string): void {
		if (this.shuttingDown) throw new Error("Factory is shutting down");
		const run = this.get(id);
		if (
			run.workflow.id !== "simple" ||
			run.status !== "completed" ||
			this.isExecuting(id)
		)
			throw new Error("Only a finished Cyrus session can continue here");
		if (run.simpleExecution) {
			if (!run.simpleExecution.agent)
				throw new Error("Session conversation unavailable");
		}
		run.simplePrompt = prompt;
		run.status = "running";
		run.error = undefined;
		this.updateViewState(id, { keptOpen: true });
		this.save(run);
		void this.launch(run);
	}
	viewState(id: string): RunViewState {
		return this.viewStates[id] ?? {};
	}
	updateViewState(id: string, state: RunViewState): RunViewState {
		this.viewStates[id] = state;
		this.atomicWrite(join(this.directory, "views.json"), this.viewStates);
		this.changed({ id });
		return state;
	}
	listWorkflows(): Workflow[] {
		return structuredClone(this.workflows);
	}
	getDefaultWorkflow(): string {
		return this.defaultWorkflow;
	}
	private validateDefault(
		workflows: Workflow[],
		defaultWorkflow: string,
	): void {
		if (!workflows.some((workflow) => workflow.id === defaultWorkflow))
			throw new Error(`Unknown default workflow: ${defaultWorkflow}`);
	}
	updateWorkflows(
		value: unknown,
		defaultWorkflow = this.defaultWorkflow,
	): Workflow[] {
		const workflows = validateWorkflows(value);
		this.validateDefault(workflows, defaultWorkflow);
		this.atomicWrite(join(this.directory, "workflows.json"), {
			workflows,
			defaultWorkflow,
		});
		this.workflows = workflows;
		this.defaultWorkflow = defaultWorkflow;
		this.changed({ config: true });
		return this.listWorkflows();
	}
	selectWorkflow(
		labels: string[],
		trigger: WorkflowTrigger,
		explicit?: string,
	): Workflow {
		return this.selectLaunch(labels, trigger, explicit).workflow;
	}
	selectLaunch(
		labels: string[],
		trigger: WorkflowTrigger,
		explicit?: string,
	): {
		workflow: Workflow;
		workflowDefinitions: Workflow[];
		selectionMethod: NonNullable<WorkflowTriggerOrigin["selectionMethod"]>;
	} {
		const selected = explicit
			? this.workflows.find((workflow) => workflow.id === explicit)
			: this.workflows.find((workflow) =>
					workflow.labels.some((label) => labels.includes(label)),
				);
		if (explicit && !selected) throw new Error(`Unknown workflow: ${explicit}`);
		const workflow =
			selected ??
			this.workflows.find((workflow) => workflow.id === this.defaultWorkflow)!;
		requireTrigger(workflow, trigger);
		return {
			workflow: structuredClone(workflow),
			workflowDefinitions: this.listWorkflows(),
			selectionMethod: explicit ? "explicit" : selected ? "label" : "default",
		};
	}
	create(options: {
		triggerOrigin: WorkflowTriggerOrigin;
		workflowDefinitions?: Workflow[];
		id?: string;
		title: string;
		repositoryId: string;
		workflow: Workflow;
		workspace: string;
		input: string;
		launchInputs?: Record<string, string>;
		source?: string;
		issueId?: string;
		workspaceId?: string;
		runner?: string;
		model?: string;
		reasoningEffort?: AgentSettings["reasoningEffort"];
		modelVariant?: string;
		serviceTier?: AgentSettings["serviceTier"];
	}): FactoryRun {
		if (
			!options.triggerOrigin ||
			!["manual", "ticket-assignment"].includes(options.triggerOrigin.type)
		)
			throw new Error(
				"A new run requires a manual or ticket-assignment origin",
			);
		if (options.triggerOrigin.workflowId !== options.workflow.id)
			throw new Error("Launch origin does not match the selected workflow");
		requireTrigger(options.workflow, options.triggerOrigin.type);
		const id = options.id ?? randomUUID();
		if (!/^[\w-]+$/.test(id)) throw new Error("Invalid run ID");
		if (this.runs.has(id)) throw new Error(`Run already exists: ${id}`);
		const now = new Date().toISOString();
		const run: FactoryRun = {
			...structuredClone(options),
			workflowDefinitions: structuredClone(
				options.workflowDefinitions ?? this.listWorkflows(),
			),
			id,
			status: "running",
			createdAt: now,
			updatedAt: now,
			outputs: {},
			history: [],
			answers: [],
			questions: [],
			events: [],
		};
		this.runs.set(run.id, run);
		this.save(run);
		return run;
	}
	get(id: string): FactoryRun {
		const run = this.runs.get(id);
		if (!run) throw new Error("Run not found");
		return run;
	}
	log(
		run: FactoryRun,
		step: string,
		message: string,
		source: RunEvent["source"] = "workflow",
		call?: WorkflowCall,
	): void {
		const at = new Date().toISOString();
		run.activitySteps ??= activityMarkers(run);
		if (
			!["run", "prepare"].includes(step) &&
			run.activitySteps.at(-1)?.step !== step
		)
			run.activitySteps.push({ at, step });
		run.events.push({
			call,
			source,
			sequence: (run.events.at(-1)?.sequence ?? run.events.length - 1) + 1,
			at,
			step,
			message: message.slice(-20000),
		});
		if (run.events.length > 1500)
			run.events.splice(0, run.events.length - 1500);
		if (source === "agent") {
			// A native turn can emit thousands of tool events in one burst. Persist
			// activity together so repeated full-run writes cannot starve HTTP I/O.
			if (!this.pendingActivitySaves.has(run.id)) {
				const timer = setTimeout(() => this.save(run), 250);
				timer.unref();
				this.pendingActivitySaves.set(run.id, timer);
			}
		} else this.save(run);
	}
	launch(
		run: FactoryRun,
		task?: (signal: AbortSignal) => Promise<void>,
	): Promise<void> {
		if (this.shuttingDown) throw new Error("Factory is shutting down");
		if (this.controllers.has(run.id))
			throw new Error("Run is already executing");
		const controller = new AbortController();
		this.controllers.set(run.id, controller);
		const execution = this.execute(run, controller, task);
		this.executions.set(run.id, execution);
		void execution.finally(() => this.executions.delete(run.id));
		return execution;
	}
	private async execute(
		run: FactoryRun,
		controller: AbortController,
		task?: (signal: AbortSignal) => Promise<void>,
	): Promise<void> {
		try {
			await this.hooks.prepare?.(run, controller.signal);
			controller.signal.throwIfAborted();
			if (task) await task(controller.signal);
			else if (run.workflow.id === "simple") {
				if (!this.hooks.simple)
					throw new Error("Simple recovery handler unavailable");
				await this.hooks.simple(run, controller.signal);
			} else {
				run.checkpoint ??= this.recoverCheckpoint(run);
				this.save(run);
				await this.graph(
					run,
					run.workflow.steps,
					run.outputs,
					controller.signal,
					"",
					run.checkpoint,
					run.workflow.id,
					run.workflow.chat ?? false,
				);
			}
			controller.signal.throwIfAborted();
			run.status = "completed";
			if (readPath(run.outputs, "merge.merged") === true)
				this.updateViewState(run.id, { settledAt: new Date().toISOString() });
			this.log(run, "run", "Workflow complete.");
		} catch (error) {
			if (this.shuttingDown && run.status !== "stopped") {
				this.log(
					run,
					"run",
					"Paused for shutdown; will resume automatically on startup.",
				);
				return;
			}
			run.status = controller.signal.aborted ? "stopped" : "failed";
			run.error = error instanceof Error ? error.message : String(error);
			controller.abort(); // Cancel sibling fanout branches on failure.
			this.log(run, "run", run.error);
		} finally {
			this.controllers.delete(run.id);
			this.pendingAnswers.delete(run.id);
			this.save(run);
		}
	}
	private async graph(
		run: FactoryRun,
		steps: WorkflowStep[],
		outputs: Record<string, unknown>,
		signal: AbortSignal,
		prefix: string,
		checkpoint: GraphCheckpoint,
		workflowId: string,
		chat = false,
	): Promise<Record<string, unknown>> {
		while (checkpoint.current !== "end") {
			signal.throwIfAborted();
			const step = steps.find((item) => item.id === checkpoint.current)!;
			const key = `${prefix}${step.id}`;
			if (!checkpoint.active) {
				checkpoint.visits[step.id] = (checkpoint.visits[step.id] ?? 0) + 1;
				checkpoint.active = { phase: "executing" };
				this.save(run);
			}
			const state = checkpoint.active;
			const count = checkpoint.visits[step.id]!;
			const limit =
				step.maxVisits + (checkpoint.additionalVisits?.[step.id] ?? 0);
			if (count > limit) {
				run.step = key;
				run.iterationLimit = { step: key, visits: count, limit };
				throw new Error(
					`Iteration limit reached at ${key} (${limit} passes). Continue grants 4 additional passes for this step; all completed work is retained.`,
				);
			}
			run.step = key;
			this.log(run, key, `Starting ${step.name} (pass ${count})`);
			const input = step.inputs
				? Object.fromEntries(step.inputs.map((name) => [name, outputs[name]]))
				: {
						originalInput: run.input,
						launchInputs: structuredClone(run.launchInputs ?? {}),
						outputs: structuredClone(outputs),
						answers: structuredClone(run.answers),
						chatMessages: structuredClone(this.chatMessages(run.id)),
						history: structuredClone(run.history),
						humanDecisions: structuredClone(run.humanDecisions ?? []),
					};
			const context: ExecutionContext = {
				run,
				step,
				stepKey: key,
				chat: step.chat ?? chat,
				input,
				outputs,
				signal,
				log: (message, source) => this.log(run, key, message, source),
				evidenceDir: join(this.directory, "evidence", run.id),
				resumeAgent: state.agent,
				checkpointAgent: (agent) => {
					state.agent = agent;
					this.save(run);
				},
			};
			mkdirSync(context.evidenceDir, { recursive: true });
			let output: unknown = outputs[step.id];
			if (state.phase === "executing") {
				if (step.type === "fanout") {
					if (
						step.groups?.some((group) =>
							group.some(
								(item) => item.askQuestions || item.tool === "human-review",
							),
						)
					)
						throw new Error("Human checkpoints belong outside fanout branches");
					state.children ??= (step.groups ?? []).map((group) => ({
						...this.newCheckpoint(group),
						outputs: structuredClone(outputs),
					}));
					this.save(run);
					output = await Promise.all(
						(step.groups ?? []).map((group, index) =>
							this.graph(
								run,
								group,
								state.children![index]!.outputs!,
								signal,
								`${key}/${index}/`,
								state.children![index]!,
								workflowId,
								chat,
							),
						),
					);
				} else if (step.type === "workflow") {
					const definition = run.workflowDefinitions?.find(
						(item) => item.id === step.workflow,
					);
					if (!definition)
						throw new Error(`Workflow unavailable: ${step.workflow}`);
					requireTrigger(definition, "workflow");
					if (!state.call) {
						state.call = {
							type: "workflow",
							callerWorkflowId: workflowId,
							step: step.id,
							key,
							workflowId: definition.id,
						};
						// Call receipts outlive the capped activity buffer, including interrupted calls.
						run.workflowCalls ??= run.events
							.filter((event) => event.call)
							.map((event) => ({ call: event.call!, at: event.at }));
						run.workflowCalls.push({
							call: state.call,
							at: new Date().toISOString(),
						});
						this.log(
							run,
							key,
							`Calling ${definition.name} from ${workflowId}/${step.id}`,
							"workflow",
							state.call,
						);
					}
					state.children ??= [this.newCheckpoint(definition.steps)];
					this.save(run);
					await this.graph(
						run,
						definition.steps,
						outputs,
						signal,
						`${key}/`,
						state.children[0]!,
						definition.id,
						definition.chat ?? chat,
					);
					output = { workflow: definition.id, completed: true };
				} else {
					output = await this.hooks[step.type](context);
				}
				signal.throwIfAborted();
				outputs[step.id] = output;
				run.history.push({
					step: key,
					output,
					at: new Date().toISOString(),
					...(state.call ? { call: state.call } : {}),
				});
				state.phase = "result";
				this.save(run);
			}
			if (step.askQuestions) {
				const questions = readPath(output, "questions");
				if (
					!Array.isArray(questions) ||
					questions.some((item) => typeof item !== "string")
				)
					throw new Error("Clarifier must return a questions array");
				if (questions.length) {
					if (state.phase !== "answered")
						await this.waitForAnswers(run, questions, signal, state);
					checkpoint.active = undefined;
					this.save(run);
					continue;
				}
			}
			if (step.tool === "human-review") {
				if (state.phase !== "answered")
					await this.waitForHuman(
						run,
						output as { headSha: string; url: string },
						signal,
						state,
					);
				output = outputs[step.id] = run.humanDecisions!.at(-1)!;
				if (
					!run.history.some(
						(item) =>
							item.step === key &&
							(item.output as HumanDecision)?.reviewId ===
								(output as HumanDecision).reviewId,
					)
				)
					run.history.push({ step: key, output, at: new Date().toISOString() });
			}
			checkpoint.current = this.nextStep(steps, step, output);
			checkpoint.active = undefined;
			this.log(run, key, `Finished ${step.name}`);
		}
		return outputs;
	}
	private async waitForAnswers(
		run: FactoryRun,
		questions: string[],
		signal: AbortSignal,
		state: NonNullable<GraphCheckpoint["active"]>,
	): Promise<void> {
		const restored = state.phase === "waiting";
		state.phase = "waiting";
		run.questions = questions;
		run.status = "waiting";
		const waiting = new Promise<void>((resolve, reject) =>
			this.pendingAnswers.set(run.id, { resolve, reject }),
		);
		// A ticket post may still be pending when termination rejects this promise.
		void waiting.catch(() => {});
		const abort = () =>
			this.pendingAnswers.get(run.id)?.reject(new Error("Run terminated"));
		signal.addEventListener("abort", abort, { once: true });
		this.log(run, run.step ?? "clarify", questions.join("\n"));
		try {
			if (!restored) await this.hooks.question?.(run);
			signal.throwIfAborted();
			await waiting;
		} finally {
			signal.removeEventListener("abort", abort);
			this.pendingAnswers.delete(run.id);
		}
	}
	private async waitForHuman(
		run: FactoryRun,
		result: { headSha: string; url: string },
		signal: AbortSignal,
		state: NonNullable<GraphCheckpoint["active"]>,
	): Promise<void> {
		if (state.phase !== "waiting")
			run.reviewGate = {
				id: randomUUID(),
				headSha: result.headSha,
				url: result.url,
				status: "pending",
			};
		state.phase = "waiting";
		run.status = "waiting";
		run.questions = [];
		const waiting = new Promise<void>((resolve, reject) =>
			this.pendingAnswers.set(run.id, { resolve, reject }),
		);
		const abort = () =>
			this.pendingAnswers.get(run.id)?.reject(new Error("Run terminated"));
		signal.addEventListener("abort", abort, { once: true });
		this.log(
			run,
			run.step ?? "human-review",
			"Ready for explicit human review. Approve this revision or request changes in the factory UI.",
		);
		try {
			signal.throwIfAborted();
			await waiting;
		} finally {
			signal.removeEventListener("abort", abort);
			this.pendingAnswers.delete(run.id);
		}
	}
	decide(id: string, decision: Omit<HumanDecision, "at">): void {
		const run = this.get(id),
			pending = this.pendingAnswers.get(id),
			gate = run.reviewGate;
		if (run.status !== "waiting" || !pending || gate?.status !== "pending")
			throw new Error("Run is not waiting for human review");
		if (gate.id !== decision.reviewId || gate.headSha !== decision.headSha)
			throw new Error(
				"The reviewed revision changed. Refresh and review again.",
			);
		if (decision.decision === "reject" && !decision.feedback?.trim())
			throw new Error("Explain what Bob should change");
		run.humanDecisions ??= [];
		run.humanDecisions.push({ ...decision, at: new Date().toISOString() });
		gate.status = decision.decision;
		const answered = (frame?: GraphCheckpoint): void => {
			if (frame?.active?.phase === "waiting") frame.active.phase = "answered";
			frame?.active?.children?.forEach(answered);
		};
		answered(run.checkpoint);
		run.outputs["human-review"] = run.humanDecisions.at(-1)!;
		run.status = "running";
		this.log(
			run,
			run.step ?? "human-review",
			`Human ${decision.decision}: ${decision.feedback ?? decision.headSha}`,
		);
		pending.resolve();
	}
	answer(id: string, answer: string): void {
		const run = this.get(id);
		const pending = this.pendingAnswers.get(id);
		if (
			run.status !== "waiting" ||
			!pending ||
			run.reviewGate?.status === "pending"
		)
			throw new Error("Run is not waiting for an answer");
		if (!answer.trim()) throw new Error("Enter an answer");
		run.answers.push({
			questions: [...run.questions],
			answer,
			at: new Date().toISOString(),
		});
		const markAnswered = (frame?: GraphCheckpoint): void => {
			if (frame?.active?.phase === "waiting") frame.active.phase = "answered";
			frame?.active?.children?.forEach(markAnswered);
		};
		markAnswered(run.checkpoint);
		run.questions = [];
		run.status = "running";
		this.log(run, run.step ?? "clarify", `Human answer: ${answer}`);
		pending.resolve();
	}
	stop(id: string): void {
		const run = this.get(id);
		if (!["running", "waiting"].includes(run.status)) return;
		run.status = "stopped";
		this.controllers.get(id)?.abort();
		this.log(run, "run", "Terminated by user");
	}
	async refreshGuide(id: string, reviewId: string): Promise<FactoryRun> {
		const run = this.get(id);
		if (
			this.shuttingDown ||
			run.status !== "waiting" ||
			run.reviewGate?.status !== "pending" ||
			run.reviewGate.id !== reviewId
		)
			throw new Error(
				"Only the current pending human guide can be regenerated",
			);
		const find = (
			frame: GraphCheckpoint | undefined,
			steps: WorkflowStep[],
		): GraphCheckpoint | undefined => {
			if (!frame) return;
			const step = steps.find((s) => s.id === frame.current);
			if (
				step?.tool === "human-review" &&
				frame.active?.phase === "waiting" &&
				steps.some(
					(s) => s.id === "guide" && s.type === "agent" && s.next === "handoff",
				) &&
				steps.some(
					(s) =>
						s.id === "handoff" && s.tool === "handoff" && s.next === step.id,
				)
			)
				return frame;
			if (step?.type === "workflow") {
				const child = run.workflowDefinitions?.find(
					(w) => w.id === step.workflow,
				);
				if (child) return find(frame.active?.children?.[0], child.steps);
			}
			return undefined;
		};
		const frame = find(run.checkpoint, run.workflow.steps);
		if (!frame)
			throw new Error("This workflow has no regeneratable guide checkpoint");
		// Retire only the waiting gate. Completed agents, evidence and history stay intact.
		delete run.reviewGate;
		this.controllers.get(id)?.abort();
		await this.executions.get(id);
		frame.current = "guide";
		delete frame.active;
		delete run.outputs.handoff;
		delete run.outputs["human-review"];
		run.status = "running";
		delete run.error;
		this.log(
			run,
			"guide",
			"Regenerating the full PR review guide; implementation, reviews and captures are retained.",
		);
		this.save(run);
		void this.launch(run);
		return run;
	}
	retry(id: string): FactoryRun {
		const run = this.get(id);
		if (this.shuttingDown) throw new Error("Factory is shutting down");
		if (
			this.controllers.has(id) ||
			!["failed", "interrupted"].includes(run.status)
		)
			throw new Error("Only failed or interrupted runs can be retried");
		// Retry is an explicit request for bounded additional work, never a global reset.
		const extend = (
			frame: GraphCheckpoint,
			steps: WorkflowStep[],
			prefix: string,
		) => {
			const step = steps.find((item) => item.id === frame.current);
			if (!step) return;
			const limit = step.maxVisits + (frame.additionalVisits?.[step.id] ?? 0);
			if ((frame.visits[step.id] ?? 0) > limit) {
				frame.additionalVisits ??= {};
				frame.additionalVisits[step.id] =
					(frame.additionalVisits[step.id] ?? 0) + 4;
				this.log(
					run,
					"run",
					`Continue authorized 4 additional passes for ${prefix}${step.id} (limit ${limit + 4}); history retained.`,
				);
			}
			if (step.type === "workflow") {
				const child = run.workflowDefinitions?.find(
					(item) => item.id === step.workflow,
				);
				if (child && frame.active?.children?.[0])
					extend(frame.active.children[0], child.steps, `${prefix}${step.id}/`);
			} else if (step.type === "fanout") {
				step.groups?.forEach((group, index) => {
					const child = frame.active?.children?.[index];
					if (child) extend(child, group, `${prefix}${step.id}/${index}/`);
				});
			}
		};
		if (run.checkpoint) extend(run.checkpoint, run.workflow.steps, "");
		delete run.iterationLimit;
		run.status = "running";
		delete run.error;
		this.log(run, "run", "Retry requested; continuing from saved progress.");
		void this.launch(run);
		return run;
	}
	isShuttingDown(): boolean {
		return this.shuttingDown;
	}
	async shutdown(): Promise<void> {
		this.shuttingDown = true;
		for (const controller of this.controllers.values()) controller.abort();
		await Promise.allSettled(this.executions.values());
		for (const id of this.pendingActivitySaves.keys()) this.save(this.get(id));
	}
	resumeAll(): void {
		for (const run of this.runs.values()) {
			if (
				!["running", "waiting"].includes(run.status) ||
				this.controllers.has(run.id)
			)
				continue;
			delete run.error;
			this.log(run, "run", "Recovering after restart from saved progress.");
			void this.launch(run);
		}
	}
	private newCheckpoint(steps: WorkflowStep[]): GraphCheckpoint {
		return { current: steps[0]?.id ?? "end", visits: {} };
	}
	private nextStep(
		steps: WorkflowStep[],
		step: WorkflowStep,
		output: unknown,
	): string {
		const branch = step.branches.find(
			(candidate) =>
				JSON.stringify(readPath(output, candidate.when.path)) ===
				JSON.stringify(candidate.when.equals),
		);
		return (
			branch?.next ?? step.next ?? steps[steps.indexOf(step) + 1]?.id ?? "end"
		);
	}
	// Upgrade active runs written before checkpoints existed using their completed receipts.
	private recoverCheckpoint(run: FactoryRun): GraphCheckpoint {
		const receipts = run.history.map((item, index) => ({ ...item, index }));
		const consumed = new Set<number>();
		const recover = (
			steps: WorkflowStep[],
			outputs: Record<string, unknown>,
			prefix: string,
		): GraphCheckpoint => {
			const frame = this.newCheckpoint(steps);
			while (frame.current !== "end") {
				const step = steps.find((item) => item.id === frame.current)!;
				const key = prefix + step.id;
				const receipt = receipts.find(
					(item) => !consumed.has(item.index) && item.step === key,
				);
				if (!receipt) {
					frame.visits[step.id] = (frame.visits[step.id] ?? 0) + 1;
					frame.active = { phase: "executing" };
					if (step.type === "agent" && run.step === key) {
						const runner =
							step.runner ??
							run.runner ??
							(run.sessionSnapshot?.codexSessionId
								? "codex"
								: run.sessionSnapshot?.geminiSessionId
									? "gemini"
									: run.sessionSnapshot?.cursorSessionId
										? "cursor"
										: run.sessionSnapshot?.opencodeSessionId
											? "opencode"
											: "claude");
						const event = [...run.events]
							.reverse()
							.find(
								(item) => item.step === key && item.message.startsWith("{"),
							);
						let sessionId: string | undefined;
						try {
							sessionId = event && JSON.parse(event.message).session_id;
						} catch {
							/* Truncated legacy event; use the saved session instead. */
						}
						sessionId ??=
							run.sessionSnapshot?.[
								`${runner as NonNullable<WorkflowStep["runner"]>}SessionId`
							];
						if (sessionId && sessionId !== "pending")
							frame.active.agent = {
								runner: runner as NonNullable<WorkflowStep["runner"]>,
								sessionId,
							};
					}
					if (step.type === "workflow") {
						const definition = run.workflowDefinitions?.find(
							(item) => item.id === step.workflow,
						);
						if (definition)
							frame.active.children = [
								recover(definition.steps, outputs, `${key}/`),
							];
					} else if (step.type === "fanout") {
						frame.active.children = step.groups?.map((group, index) => {
							const branchOutputs = structuredClone(outputs);
							return {
								...recover(group, branchOutputs, `${key}/${index}/`),
								outputs: branchOutputs,
							};
						});
					}
					break;
				}
				consumed.add(receipt.index);
				// A completed wrapper also consumed all receipts of that invocation.
				for (const child of receipts)
					if (child.index < receipt.index && child.step.startsWith(`${key}/`))
						consumed.add(child.index);
				frame.visits[step.id] = (frame.visits[step.id] ?? 0) + 1;
				outputs[step.id] = receipt.output;
				if (
					step.askQuestions &&
					Array.isArray(readPath(receipt.output, "questions")) &&
					(readPath(receipt.output, "questions") as unknown[]).length
				) {
					const answered = run.answers.some(
						(answer) =>
							answer.at >= receipt.at &&
							JSON.stringify(answer.questions) ===
								JSON.stringify(readPath(receipt.output, "questions")),
					);
					if (!answered) {
						frame.active = { phase: "waiting" };
						break;
					}
					continue;
				}
				frame.current = this.nextStep(steps, step, receipt.output);
			}
			return frame;
		};
		return recover(run.workflow.steps, run.outputs, "");
	}
	save(run: FactoryRun): void {
		const pending = this.pendingActivitySaves.get(run.id);
		if (pending) {
			clearTimeout(pending);
			this.pendingActivitySaves.delete(run.id);
		}
		run.updatedAt = new Date().toISOString();
		this.atomicWrite(join(this.directory, "runs", `${run.id}.json`), run);
		this.changed({ id: run.id });
	}
	private atomicWrite(path: string, data: unknown): void {
		const temporary = `${path}.tmp`;
		writeFileSync(temporary, JSON.stringify(data, null, 2));
		renameSync(temporary, path);
	}
}
