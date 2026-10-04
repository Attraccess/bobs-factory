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
import type { AgentSettings } from "./AgentSettings.js";
import { defaultWorkflows, upgradeWorkflows } from "./defaultWorkflows.js";
import {
	readPath,
	validateWorkflows,
	type Workflow,
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
	at: string;
	step: string;
	message: string;
}
export interface AgentCheckpoint {
	runner: NonNullable<WorkflowStep["runner"]>;
	sessionId: string;
}
export interface GraphCheckpoint {
	current: string;
	visits: Record<string, number>;
	active?: {
		phase: "executing" | "result" | "waiting" | "answered";
		agent?: AgentCheckpoint;
		children?: GraphCheckpoint[];
	};
	// Only fanout branches own separate outputs; nested workflows share their parent's.
	outputs?: Record<string, unknown>;
}
export interface FactoryRun {
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
	issueId?: string;
	workspaceId?: string;
	step?: string;
	checkpoint?: GraphCheckpoint;
	simpleExecution?: {
		userPrompt: string;
		systemPrompt?: string;
		runner: NonNullable<WorkflowStep["runner"]>;
		agent?: AgentCheckpoint;
	};
	launchRequest?: import("./LaunchFields.js").ResolvedLaunchRequest;
	setupComplete?: boolean;
	sessionSnapshot?: import("cyrus-core").SerializedCyrusAgentSession;
	outputs: Record<string, unknown>;
	history: { step: string; output: unknown; at: string }[];
	answers: { questions: string[]; answer: string; at: string }[];
	questions: string[];
	events: RunEvent[];
	error?: string;
}
export interface ExecutionContext {
	run: FactoryRun;
	step: WorkflowStep;
	input: unknown;
	outputs?: Record<string, unknown>;
	signal: AbortSignal;
	log: (message: string) => void;
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
	private controllers = new Map<string, AbortController>();
	private pendingAnswers = new Map<
		string,
		{ resolve: () => void; reject: (error: Error) => void }
	>();
	private workflows: Workflow[];
	private executions = new Map<string, Promise<void>>();
	private shuttingDown = false;
	private defaultWorkflow = "simple";
	readonly directory: string;

	constructor(
		home: string,
		private hooks: RuntimeHooks,
	) {
		this.directory = join(home, "factory");
		mkdirSync(join(this.directory, "runs"), { recursive: true });
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
		for (const filename of readdirSync(join(this.directory, "runs"))) {
			if (!filename.endsWith(".json")) continue;
			const run: FactoryRun = JSON.parse(
				readFileSync(join(this.directory, "runs", filename), "utf8"),
			);

			this.runs.set(run.id, run);
		}
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
		if (
			!workflows.some(
				(workflow) => workflow.id === defaultWorkflow && !workflow.internal,
			)
		)
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
		return this.listWorkflows();
	}
	selectWorkflow(labels: string[], explicit?: string): Workflow {
		const selected = explicit
			? this.workflows.find(
					(workflow) => workflow.id === explicit && !workflow.internal,
				)
			: this.workflows.find(
					(workflow) =>
						!workflow.internal &&
						workflow.labels.some((label) => labels.includes(label)),
				);
		if (explicit && !selected) throw new Error(`Unknown workflow: ${explicit}`);
		return structuredClone(
			selected ??
				this.workflows.find(
					(workflow) => workflow.id === this.defaultWorkflow,
				)!,
		);
	}
	create(options: {
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
	}): FactoryRun {
		const id = options.id ?? randomUUID();
		if (!/^[\w-]+$/.test(id)) throw new Error("Invalid run ID");
		if (this.runs.has(id)) throw new Error(`Run already exists: ${id}`);
		const now = new Date().toISOString();
		const run: FactoryRun = {
			...structuredClone(options),
			workflowDefinitions: this.listWorkflows(),
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
	log(run: FactoryRun, step: string, message: string): void {
		run.events.push({
			at: new Date().toISOString(),
			step,
			message: message.slice(-20000),
		});
		if (run.events.length > 1500)
			run.events.splice(0, run.events.length - 1500);
		this.save(run);
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
				);
			}
			controller.signal.throwIfAborted();
			run.status = "completed";
			this.log(run, "run", "Workflow complete. Ready for human review.");
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
			if (count > step.maxVisits)
				throw new Error(
					`Iteration limit reached at ${key}. Review history is retained; human intervention is needed.`,
				);
			run.step = key;
			this.log(run, key, `Starting ${step.name} (pass ${count})`);
			const input = step.inputs
				? Object.fromEntries(step.inputs.map((name) => [name, outputs[name]]))
				: {
						originalInput: run.input,
						launchInputs: structuredClone(run.launchInputs ?? {}),
						outputs: structuredClone(outputs),
						answers: structuredClone(run.answers),
						history: structuredClone(run.history),
					};
			const context: ExecutionContext = {
				run,
				step,
				input,
				outputs,
				signal,
				log: (message) => this.log(run, key, message),
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
							group.some((item) => item.askQuestions),
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
							),
						),
					);
				} else if (step.type === "workflow") {
					const definition = run.workflowDefinitions?.find(
						(item) => item.id === step.workflow,
					);
					if (!definition)
						throw new Error(`Workflow unavailable: ${step.workflow}`);
					state.children ??= [this.newCheckpoint(definition.steps)];
					this.save(run);
					await this.graph(
						run,
						definition.steps,
						outputs,
						signal,
						`${key}/`,
						state.children[0]!,
					);
					output = { workflow: definition.id, completed: true };
				} else {
					output = await this.hooks[step.type](context);
				}
				signal.throwIfAborted();
				outputs[step.id] = output;
				run.history.push({ step: key, output, at: new Date().toISOString() });
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
	answer(id: string, answer: string): void {
		const run = this.get(id);
		const pending = this.pendingAnswers.get(id);
		if (run.status !== "waiting" || !pending)
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
	retry(id: string): FactoryRun {
		const run = this.get(id);
		if (this.shuttingDown) throw new Error("Factory is shutting down");
		if (
			this.controllers.has(id) ||
			!["failed", "interrupted"].includes(run.status)
		)
			throw new Error("Only failed or interrupted runs can be retried");
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
		run.updatedAt = new Date().toISOString();
		this.atomicWrite(join(this.directory, "runs", `${run.id}.json`), run);
	}
	private atomicWrite(path: string, data: unknown): void {
		const temporary = `${path}.tmp`;
		writeFileSync(temporary, JSON.stringify(data, null, 2));
		renameSync(temporary, path);
	}
}
