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
import type {
	RunTitleJob,
	WorkflowTrigger,
	WorkflowTriggerOrigin,
} from "bobs-factory-core";
import type {
	CapacityOptions,
	CapacityRequest,
	ExecutionCapacity,
} from "../MachineCapacity.js";
import { activityMarkers } from "./ActivityPage.js";
import {
	type AgentSettings,
	AgentSettingsSchema,
	resolveAgentSettings,
} from "./AgentSettings.js";
import {
	defaultWorkflows,
	upgradeHandoffReadiness,
	upgradeWorkflows,
} from "./defaultWorkflows.js";
import type { RoleProgress, RoleRevision } from "./Incremental.js";
import {
	normalizeQuestionResult,
	type QuestionRecommendation,
	questionNotification,
} from "./Questions.js";
import { buildTitleContext } from "./RunTitleGenerator.js";
import {
	isComputeIntensive,
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
	/** Persisted per-role budget for resuming a silent provider turn. */
	idleRetries?: number;
	runner: NonNullable<WorkflowStep["runner"]>;
	sessionId: string;
	result?: {
		output: unknown;
		revision: RoleRevision;
		finalizing?: boolean;
		reviewScope?: RoleProgress["reviewScope"];
	};
	rejected?: {
		output: unknown;
		issues: {
			path: string;
			message: string;
			expected?: unknown;
			actual?: unknown;
		}[];
		revision?: RoleRevision;
		attempts: number;
		exhausted?: boolean;
		screenshots?: { path: string; area: string; state?: string }[];
	};
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
	ticketReference?: import("./TicketTracking.js").TicketReference;
	ticketSync?: import("./TicketTracking.js").TicketSync;
	triggerOrigin?: WorkflowTriggerOrigin;
	workflowCalls?: { call: WorkflowCall; at: string }[];
	id: string;
	title: string;
	titleGeneration?: RunTitleJob;
	repositoryId: string;
	workflow: Workflow;
	workflowDefinitions?: Workflow[];
	contractVersion?: number;
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
	capacityLeaves?: Record<
		string,
		{
			phase:
				| "queued"
				| "executing"
				| "stopping"
				| "waiting-ci"
				| "waiting-human";
			request?: CapacityRequest;
		}
	>;
	simplePrompt?: string;
	simpleExecution?: {
		userPrompt: string;
		systemPrompt?: string;
		runner: NonNullable<WorkflowStep["runner"]>;
		agent?: AgentCheckpoint;
	};
	launchRequest?: import("./LaunchFields.js").ResolvedLaunchRequest;
	setupComplete?: boolean;
	sessionSnapshot?: import("bobs-factory-core").SerializedCyrusAgentSession;
	reviewGate?: ReviewGate;
	humanDecisions?: HumanDecision[];
	roleRevisions?: Record<string, RoleRevision>;
	outputs: Record<string, unknown>;
	history: { step: string; output: unknown; at: string; call?: WorkflowCall }[];
	answers: { questions: string[]; answer: string; at: string }[];
	questions: string[];
	questionRecommendations?: QuestionRecommendation[];
	questionBatchId?: string;
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
	capacity?: CapacityOptions;
	chat?: boolean;
	chatMessages?: ChatMessage[];
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
	capacity?: ExecutionCapacity;
	track?(
		run: FactoryRun,
		milestone: import("./TicketTracking.js").TicketMilestone,
	): Promise<void>;
	retryTracking?(run: FactoryRun): Promise<void>;
	titleDefaults?(
		runner?: RunTitleJob["settings"]["runner"],
	): RunTitleJob["settings"];
	stopTitle?(id: string): void;
	agent(context: ExecutionContext): Promise<unknown>;
	script(context: ExecutionContext): Promise<unknown>;
	tool(context: ExecutionContext): Promise<unknown>;
	question?(run: FactoryRun): Promise<void>;
	simple?(run: FactoryRun, signal: AbortSignal): Promise<void>;
	prepare?(run: FactoryRun, signal: AbortSignal): Promise<void>;
	finished?(run: FactoryRun): Promise<void>;
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
	private titleSettings: AgentSettings = {};
	private viewStates: Record<string, RunViewState> = {};
	private chats = new Map<string, ChatMessage[]>();
	readonly directory: string;

	constructor(
		home: string,
		private hooks: RuntimeHooks,
	) {
		this.directory = join(home, "factory");
		mkdirSync(join(this.directory, "runs"), { recursive: true });
		const settings = join(this.directory, "settings.json");
		if (existsSync(settings))
			this.titleSettings = AgentSettingsSchema.parse(
				JSON.parse(readFileSync(settings, "utf8")).titleGeneration ?? {},
			);
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

			// Persisted definitions are immutable. Legacy contract migration occurs
			// explicitly at retry/start, preserving graph positions and native IDs.

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
	recordChatMessage(
		id: string,
		text: string,
		step: string,
		messageId: string = randomUUID(),
	): ChatMessage {
		const message = {
			id: messageId,
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
			throw new Error(
				"Only a finished Bob’s Factory session can continue here",
			);
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
	getTitleSettings(): AgentSettings {
		return structuredClone(this.titleSettings);
	}
	resolveTitleSettings(): RunTitleJob["settings"] {
		const defaults = this.hooks.titleDefaults?.() ?? {
			runner: "claude" as const,
		};
		const runner = this.titleSettings.runner ?? defaults.runner;
		return {
			runner,
			model:
				this.titleSettings.model ?? this.hooks.titleDefaults?.(runner).model,
			...resolveAgentSettings(runner, this.titleSettings),
		};
	}
	createTitleJob(context: string): RunTitleJob {
		try {
			return {
				state: "pending",
				settings: this.resolveTitleSettings(),
				context,
			};
		} catch (error) {
			// Changing the inherited provider can invalidate saved native controls.
			// Naming configuration must never prevent the primary task from starting.
			return {
				state: "failed",
				settings: {
					runner:
						this.titleSettings.runner ??
						this.hooks.titleDefaults?.().runner ??
						"claude",
				},
				context,
				error: (error instanceof Error
					? error.message
					: "Invalid title agent settings"
				).slice(0, 240),
			};
		}
	}
	updateTitleSettings(value: unknown): AgentSettings {
		const settings = AgentSettingsSchema.strict().parse(value);
		resolveAgentSettings(
			settings.runner ?? this.hooks.titleDefaults?.().runner ?? "claude",
			settings,
		);
		this.atomicWrite(join(this.directory, "settings.json"), {
			titleGeneration: settings,
		});
		this.titleSettings = settings;
		this.changed({ config: true });
		return this.getTitleSettings();
	}
	updateTitle(id: string, job: RunTitleJob, title?: string): void {
		const run = this.get(id);
		run.titleGeneration = structuredClone(job);
		if (title) run.title = title;
		if (run.sessionSnapshot) {
			run.sessionSnapshot.displayTitle = run.title;
			run.sessionSnapshot.titleGeneration = structuredClone(job);
		}
		this.save(run);
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
		title?: string;
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
			contractVersion: 2,
			id,
			title: id,
			titleGeneration: {
				...this.createTitleJob(
					buildTitleContext({
						workflow: options.workflow.name,
						instructions: options.input,
						source: options.source,
						inputs: options.launchInputs,
					}),
				),
				repositoryId: options.repositoryId,
			},
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
		if (run.status === "waiting") run.status = "running";
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
			for (const definition of [
				run.workflow,
				...(run.workflowDefinitions ?? []),
			]) {
				if (
					["factory", "factory-pipeline"].includes(definition.id) &&
					upgradeHandoffReadiness(definition.steps)
				)
					this.log(
						run,
						"run",
						"Enabled handoff recovery through the existing CI fixer; saved checkpoint, roles and completed work retained.",
					);
			}
			if (run.contractVersion !== 2) {
				if (run.contractVersion !== undefined && run.contractVersion !== 1)
					throw new Error(
						`Unsupported workflow contract version: ${run.contractVersion}`,
					);
				run.contractVersion = 2;
				this.log(
					run,
					"run",
					"Migrated legacy output contract to v2 at execution boundary; workflow definitions, checkpoint positions and accepted history preserved.",
				);
			}
			await this.hooks.prepare?.(run, controller.signal);
			controller.signal.throwIfAborted();
			if (run.ticketReference && this.hooks.track)
				await this.track(run, {
					key: "started",
					stage: "in_progress",
					body: `Factory work started: ${run.workflow.name}. Run ${run.id}.\n\n${String(readPath(run.outputs, "ticket.title") ?? run.title)}\n${run.launchRequest?.prompt ?? ""}`,
				});
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
			if (
				!this.shuttingDown &&
				["completed", "failed", "stopped"].includes(run.status)
			)
				try {
					if (run.ticketReference && this.hooks.track)
						await this.track(run, {
							key: `outcome:${run.status}:${run.history.length}`,
							body:
								run.status === "completed"
									? `Workflow ${run.workflow.name} completed. Coding tickets become Done only after confirmed merge. Inspect run ${run.id} for results.`
									: `Workflow ${run.status}: ${run.error ?? "stopped by user"}. Work is preserved in run ${run.id}; restore access or answer the blocker before retrying.`,
						});
					await this.hooks.finished?.(run);
				} catch (error) {
					this.log(
						run,
						"ticket-sync",
						`Final tracking hook failed: ${String(error)}. Underlying run outcome retained.`,
					);
				}
		}
	}
	capacityOptions(run: FactoryRun, key: string, visit = 1): CapacityOptions {
		return {
			identity: `${this.directory}:run:${run.id}:${key}:${visit}`,
			recoverable: true,
			preserveOnShutdown: () => run.status !== "stopped",
			onChange: (request) => {
				run.capacityLeaves ??= {};
				const previous = run.capacityLeaves[key]?.phase;
				if (request && request.phase !== previous)
					this.log(
						run,
						key,
						request.phase === "queued"
							? "Waiting for instance capacity."
							: request.phase === "stopping"
								? "Stopping execution; capacity remains reserved until it settles."
								: "Instance capacity admitted execution.",
					);
				if (request)
					run.capacityLeaves[key] = { phase: request.phase, request };
				else delete run.capacityLeaves[key];
				this.save(run);
			},
		};
	}
	private async track(
		run: FactoryRun,
		milestone: import("./TicketTracking.js").TicketMilestone,
	): Promise<void> {
		try {
			await this.hooks.track?.(run, milestone);
		} catch (error) {
			this.log(run, "ticket-sync", `Ticket tracking failed: ${String(error)}`);
		}
	}
	async retryTracking(id: string): Promise<void> {
		await this.hooks.retryTracking?.(this.get(id));
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
		parallel = false,
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
				? {
						...(run.ticketReference
							? {
									ticketReference: structuredClone(run.ticketReference),
									ticketSync: structuredClone(run.ticketSync),
								}
							: {}),
						...Object.fromEntries(
							step.inputs.map((name) => [name, outputs[name]]),
						),
						...(step.askQuestions ||
						(step.id === "capture" &&
							(step.qaContract === "qa-v1" ||
								readPath(outputs, "visual-gate.captureBlocked") === true ||
								readPath(outputs, "visual-gate.qaBlocked") === true))
							? { answers: structuredClone(run.answers) }
							: {}),
					}
				: {
						originalInput: run.input,
						...(run.ticketReference
							? {
									ticketReference: structuredClone(run.ticketReference),
									ticketSync: structuredClone(run.ticketSync),
								}
							: {}),
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
				capacity: this.capacityOptions(run, key, count),
				chat: step.chat ?? chat,
				chatMessages: structuredClone(this.chatMessages(run.id)),
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
					const branchController = new AbortController();
					const cancelBranches = () => branchController.abort(signal.reason);
					signal.addEventListener("abort", cancelBranches, { once: true });
					if (signal.aborted) cancelBranches();
					let failure: unknown;
					const branchResults = await Promise.allSettled(
						(step.groups ?? []).map((group, index) =>
							this.graph(
								run,
								group,
								state.children![index]!.outputs!,
								branchController.signal,
								`${key}/${index}/`,
								state.children![index]!,
								workflowId,
								chat,
								true,
							).catch((error) => {
								failure ??= error;
								branchController.abort(error);
								throw error;
							}),
						),
					);
					signal.removeEventListener("abort", cancelBranches);
					if (failure) throw failure;
					output = branchResults.map((result) =>
						result.status === "fulfilled" ? result.value : undefined,
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
						parallel,
					);
					output = { workflow: definition.id, completed: true };
				} else {
					run.capacityLeaves ??= {};
					run.capacityLeaves[key] = {
						phase:
							step.tool === "ci" ||
							step.tool === "merge-readiness" ||
							step.tool === "handoff"
								? "waiting-ci"
								: step.tool === "human-review"
									? "waiting-human"
									: "executing",
					};
					this.save(run);
					try {
						if (
							step.type !== "agent" &&
							isComputeIntensive(step) &&
							this.hooks.capacity
						) {
							const lease = await this.hooks.capacity.acquireLease(signal, {
								...context.capacity,
								remote: step.tool?.startsWith("mcp__"),
							});
							try {
								signal.throwIfAborted();
								output = await lease.run(() =>
									this.hooks[step.type as "script" | "tool"](context),
								);
							} finally {
								await lease.release();
							}
						} else output = await this.hooks[step.type](context);
					} finally {
						if (!this.shuttingDown || run.status === "stopped")
							delete run.capacityLeaves[key];
						this.save(run);
					}
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
			// Restored waits must use current gate logic, retaining all role evidence.
			if (
				step.tool === "visual-gate" &&
				state.phase === "waiting" &&
				step.qaContract
			) {
				output = outputs[step.id] = await this.hooks.tool(context);
				// Keep the restored wait until its questions and suggestions are compared
				// below. Gate revalidation alone does not create a new question batch.
				this.save(run);
			}
			if (
				step.tool === "visual-gate" &&
				readPath(output, "reviewBlocked") !== true &&
				Array.isArray(readPath(output, "findings")) &&
				(readPath(output, "findings") as unknown[]).length
			) {
				// Review assistance retains its saved questions for waitForAnswers to
				// compare after restart. Findings without a wait proceed to correction.
				run.status = "running";
				run.questions = [];
			}
			if (
				step.tool === "draft-pr" ||
				step.tool === "handoff" ||
				step.tool === "merge" ||
				step.id === "implement" ||
				step.id === "plan"
			) {
				const pr = readPath(output, "url");
				const merged =
					step.tool === "merge" && readPath(output, "merged") === true;
				const handoffFix =
					step.tool === "handoff" && readPath(output, "fix") === true;
				const stage = merged
					? "done"
					: step.tool === "handoff"
						? handoffFix
							? "in_progress"
							: "in_review"
						: step.tool === "merge"
							? readPath(output, "fix") === true
								? "in_progress"
								: "in_review"
							: "in_progress";
				let body = merged
					? `Git provider confirmed merge: ${pr}. Run ${run.id}.`
					: step.tool === "handoff"
						? handoffFix
							? `Handoff requires corrections: ${pr}. Corrective work continues in Factory.`
							: `Ready for human review: ${pr}. Review the guide and explicitly approve this revision or request changes in Factory. ${String(readPath(outputs, "guide.summary") ?? "")}`
						: step.tool === "draft-pr"
							? `Draft PR created or continued: ${pr}. Review and validation are underway.`
							: `${step.name}: ${String(readPath(output, "summary") ?? (step.id === "plan" ? "Implementation direction recorded in the accepted plan." : "Inspect the implementation receipts and checks in Factory."))}`;
				const blockers = readPath(output, "blockers");
				if (handoffFix && Array.isArray(blockers))
					body += `\n\nBlockers:\n${blockers
						.map((blocker) => readPath(blocker, "message"))
						.filter((message) => typeof message === "string")
						.map((message) => `- ${message}`)
						.join("\n")}`;
				const checks = readPath(output, "checks");
				if (step.id === "implement" && Array.isArray(checks))
					body += `\n\nChecks:\n${checks
						.filter((check) => typeof check === "string")
						.map((check) => `- ${check}`)
						.join("\n")}`;
				if (run.ticketReference && this.hooks.track)
					await this.track(run, {
						key: `${key}:${count}:${readPath(output, "headSha") ?? "result"}`,
						stage,
						body,
						...(typeof pr === "string" ? { pr } : {}),
						...(merged ? { merged: true } : {}),
					});
			}
			if (
				step.tool === "visual-gate" &&
				(readPath(output, "captureBlocked") === true ||
					readPath(output, "qaBlocked") === true ||
					readPath(output, "qaRetry") === true) &&
				!(
					Array.isArray(readPath(output, "findings")) &&
					(readPath(output, "findings") as unknown[]).length
				)
			) {
				// Existing runs keep their frozen graph. Recover inside that graph rather
				// than replacing its recipe or rerunning implementation/code fixes.
				const capture = steps.find((item) => item.id === "capture");
				const review = steps.find((item) => item.id === "visual-review");
				if (parallel)
					throw new Error("Human checkpoints belong outside fanout branches");
				if (
					!capture ||
					!["agent", "script"].includes(capture.type) ||
					capture.branches.length > 0 ||
					!review ||
					!["agent", "script"].includes(review.type) ||
					review.branches.length > 0 ||
					this.nextStep(steps, capture, {}) !== review.id ||
					this.nextStep(steps, review, {}) !== step.id
				)
					throw new Error(
						"QA or visual evidence is incomplete and this recipe has no capture → visual-review → visual-gate recovery path. Configure that path for a new run; missing evidence cannot be approved.",
					);
				if (readPath(output, "qaRetry") === true) {
					checkpoint.current = capture.id;
					checkpoint.active = undefined;
					run.questions = [];
					run.status = "running";
					this.log(
						run,
						key,
						`Retrying invalid QA evidence: ${JSON.stringify(readPath(output, "evidenceIssues"))}`,
					);
					continue;
				}
				const questions = readPath(output, "questions");
				if (
					!Array.isArray(questions) ||
					!questions.length ||
					questions.some((item) => typeof item !== "string" || !item.trim())
				)
					throw new Error("QA/capture assistance requires a question");
				if (state.phase !== "answered")
					await this.waitForAnswers(
						run,
						questions,
						signal,
						state,
						normalizeQuestionResult(output).questionRecommendations as
							| QuestionRecommendation[]
							| undefined,
					);
				checkpoint.current = capture.id;
				checkpoint.active = undefined;
				this.log(
					run,
					key,
					"QA/capture assistance received; retrying testing and screenshot review with prior evidence retained.",
				);
				continue;
			}
			if (
				step.tool === "review-after-fix" &&
				Array.isArray(readPath(output, "questions")) &&
				(readPath(output, "questions") as unknown[]).length
			) {
				if (parallel)
					throw new Error("Human checkpoints belong outside fanout branches");
				if (!steps.some((item) => item.id === "ci-fix"))
					throw new Error("CI assistance has no configured fixer");
				if (state.phase !== "answered")
					await this.waitForAnswers(
						run,
						readPath(output, "questions") as string[],
						signal,
						state,
					);
				checkpoint.current = "ci-fix";
				checkpoint.active = undefined;
				continue;
			}
			if (
				["review-gate", "visual-gate"].includes(step.tool ?? "") &&
				readPath(output, "reviewBlocked") === true
			) {
				if (parallel)
					throw new Error("Human checkpoints belong outside fanout branches");
				const fixer = this.nextStep(steps, step, output);
				if (
					!steps.some(
						(item) =>
							item.id === fixer && ["agent", "script"].includes(item.type),
					)
				)
					throw new Error(
						"Review assistance has no configured fixer recovery path",
					);
				if (state.phase !== "answered")
					await this.waitForAnswers(
						run,
						readPath(output, "questions") as string[],
						signal,
						state,
					);
				checkpoint.current = fixer;
				checkpoint.active = undefined;
				continue;
			}
			if (
				step.askQuestions ||
				(["ci-fix", "code-fix", "visual-fix"].includes(step.id) &&
					Array.isArray(readPath(output, "questions")))
			) {
				const questions = readPath(output, "questions");
				if (
					!Array.isArray(questions) ||
					questions.some((item) => typeof item !== "string")
				)
					throw new Error("Clarifier must return a questions array");
				if (questions.length) {
					if (parallel)
						throw new Error("Human checkpoints belong outside fanout branches");
					if (state.phase !== "answered")
						await this.waitForAnswers(
							run,
							questions,
							signal,
							state,
							normalizeQuestionResult(output).questionRecommendations as
								| QuestionRecommendation[]
								| undefined,
						);
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
				const decision = output as HumanDecision;
				if (run.ticketReference && this.hooks.track)
					await this.track(run, {
						key: `decision:${decision.reviewId}`,
						stage: decision.decision === "reject" ? "in_progress" : "in_review",
						body:
							decision.decision === "reject"
								? `Human requested corrections: ${decision.feedback}. Corrective work resumes with the existing PR.`
								: "Human approved the revision. Waiting for provider requirements or confirmed merge; ticket remains In Review.",
					});
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
		recommendations?: QuestionRecommendation[],
	): Promise<void> {
		const restored =
			state.phase === "waiting" &&
			isDeepStrictEqual(run.questions, questions) &&
			isDeepStrictEqual(run.questionRecommendations, recommendations);
		state.phase = "waiting";
		run.questions = questions;
		run.questionRecommendations = recommendations;
		if (!restored || !run.questionBatchId) run.questionBatchId = randomUUID();
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
			if (run.ticketReference && this.hooks.track)
				await this.track(run, {
					key: `questions:${run.step}:${run.answers.length}`,
					body: `Factory needs assistance:\n\n${questionNotification(questions, run.questionRecommendations)}`,
				});
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
		run.questionRecommendations = undefined;
		run.questionBatchId = undefined;
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
			if (run.ticketReference && this.hooks.track)
				await this.track(run, {
					key: `review:${run.reviewGate!.id}`,
					stage: "in_review",
					pr: result.url,
					body: `Awaiting explicit human approval for ${result.url}. Review the guide, then approve this revision or request changes in Factory.`,
				});
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
		run.questionRecommendations = undefined;
		run.questionBatchId = undefined;
		run.status = "running";
		this.log(run, run.step ?? "clarify", `Human answer: ${answer}`);
		pending.resolve();
	}
	stop(id: string): void {
		const run = this.get(id);
		this.hooks.stopTitle?.(id);
		if (!["running", "waiting", "failed", "interrupted"].includes(run.status))
			return;
		run.status = "stopped";
		this.controllers.get(id)?.abort();
		this.log(run, "run", "Terminated by user");
		if (run.ticketReference && this.hooks.track)
			void this.track(run, {
				key: `outcome:stopped:${run.history.length}`,
				body: `Workflow stopped by user. Run ${run.id} retains its work and remains open; resume or start a follow-up when ready.`,
			});
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
			const key = `${prefix}${step.id}`;
			if (
				frame.active?.phase === "executing" &&
				this.isUnstartedCodexAgent(run, frame.active.agent, key)
			) {
				delete frame.active.agent;
				this.log(
					run,
					"run",
					`Removed invalid Codex startup checkpoint for ${key}; retry starts this role with saved context, work and evidence retained.`,
				);
			}
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
	private isUnstartedCodexAgent(
		run: FactoryRun,
		agent: AgentCheckpoint | undefined,
		key: string,
	): boolean {
		if (!agent || agent.runner !== "codex" || agent.result || agent.rejected)
			return false;
		const parse = (text: string) => {
			try {
				return JSON.parse(text);
			} catch {
				return undefined;
			}
		};
		const failure = parse(
			run.error?.replace(/^Agent(?: step)? failed: /, "") ?? "",
		);
		const missing = `thread/resume failed: no rollout found for thread id ${agent.sessionId}`;
		const isStartupTimeout = (error: unknown) =>
			typeof error === "string" &&
			/^initialize timed out after \d+ms$/.test(error);
		if (
			failure?.type !== "result" ||
			failure.is_error !== true ||
			failure.session_id !== agent.sessionId ||
			!Array.isArray(failure.errors) ||
			!failure.errors.includes(missing)
		)
			return false;
		// Older runners emitted synthetic init IDs even when initialize failed.
		// Require that exact startup receipt as well as the missing-rollout error;
		// never discard an established conversation or a saved output/correction.
		let startupFailed = false;
		const completedAt =
			[...run.history].reverse().find((receipt) => receipt.step === key)?.at ??
			run.createdAt;
		for (const event of run.events) {
			if (
				event.step !== key ||
				event.source !== "agent" ||
				event.at < completedAt
			)
				continue;
			const message = parse(event.message);
			// Truncated activity cannot establish that the conversation never ran.
			if (!message) return false;
			if (message?.session_id !== agent.sessionId) continue;
			if (message.type === "system" && message.subtype === "init") continue;
			if (
				message.type !== "result" ||
				message.is_error !== true ||
				!Array.isArray(message.errors) ||
				!message.errors.length ||
				!message.errors.every(
					(error: unknown) => isStartupTimeout(error) || error === missing,
				)
			)
				return false;
			if (message.errors.some(isStartupTimeout)) startupFailed = true;
		}
		return startupFailed;
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

/** Durable run status remains compatible; API derives queueing from all active leaves. */
export function capacityRunStatus(run: FactoryRun): string {
	const leaves = Object.values(run.capacityLeaves ?? {});
	return run.status === "running" &&
		leaves.length &&
		leaves.every((leaf) => leaf.phase === "queued")
		? "capacity-waiting"
		: run.status;
}
