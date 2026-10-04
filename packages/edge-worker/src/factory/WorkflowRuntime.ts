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
import { defaultWorkflows } from "./defaultWorkflows.js";
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
export interface FactoryRun {
	id: string;
	title: string;
	repositoryId: string;
	workflow: Workflow;
	status: RunStatus;
	createdAt: string;
	updatedAt: string;
	workspace: string;
	input: string;
	runner?: string;
	model?: string;
	issueId?: string;
	workspaceId?: string;
	step?: string;
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
}
export interface RuntimeHooks {
	agent(context: ExecutionContext): Promise<unknown>;
	script(context: ExecutionContext): Promise<unknown>;
	tool(context: ExecutionContext): Promise<unknown>;
	question?(run: FactoryRun): Promise<void>;
}

export class WorkflowRuntime {
	readonly runs = new Map<string, FactoryRun>();
	private controllers = new Map<string, AbortController>();
	private pendingAnswers = new Map<
		string,
		{ resolve: () => void; reject: (error: Error) => void }
	>();
	private workflows: Workflow[];
	readonly directory: string;

	constructor(
		home: string,
		private hooks: RuntimeHooks,
	) {
		this.directory = join(home, "factory");
		mkdirSync(join(this.directory, "runs"), { recursive: true });
		const config = join(this.directory, "workflows.json");
		this.workflows = existsSync(config)
			? validateWorkflows(JSON.parse(readFileSync(config, "utf8")))
			: structuredClone(defaultWorkflows);
		for (const filename of readdirSync(join(this.directory, "runs"))) {
			if (!filename.endsWith(".json")) continue;
			const run: FactoryRun = JSON.parse(
				readFileSync(join(this.directory, "runs", filename), "utf8"),
			);
			if (run.status === "running" || run.status === "waiting") {
				run.status = "interrupted";
				run.error =
					"Cyrus restarted. History is retained; start a new run to continue safely.";
				this.save(run);
			}
			this.runs.set(run.id, run);
		}
	}

	listWorkflows(): Workflow[] {
		return structuredClone(this.workflows);
	}
	updateWorkflows(value: unknown): Workflow[] {
		const workflows = validateWorkflows(value);
		this.atomicWrite(join(this.directory, "workflows.json"), workflows);
		this.workflows = workflows;
		return this.listWorkflows();
	}
	selectWorkflow(labels: string[], explicit?: string): Workflow {
		const selected = explicit
			? this.workflows.find((workflow) => workflow.id === explicit)
			: this.workflows.find((workflow) =>
					workflow.labels.some((label) => labels.includes(label)),
				);
		if (explicit && !selected) throw new Error(`Unknown workflow: ${explicit}`);
		return structuredClone(
			selected ?? this.workflows.find((workflow) => workflow.id === "simple")!,
		);
	}
	create(options: {
		id?: string;
		title: string;
		repositoryId: string;
		workflow: Workflow;
		workspace: string;
		input: string;
		issueId?: string;
		workspaceId?: string;
		runner?: string;
		model?: string;
	}): FactoryRun {
		const id = options.id ?? randomUUID();
		if (!/^[\w-]+$/.test(id)) throw new Error("Invalid run ID");
		if (this.runs.has(id)) throw new Error(`Run already exists: ${id}`);
		const now = new Date().toISOString();
		const run: FactoryRun = {
			...options,
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
		if (this.controllers.has(run.id))
			throw new Error("Run is already executing");
		const controller = new AbortController();
		this.controllers.set(run.id, controller);
		return this.execute(run, controller, task);
	}
	private async execute(
		run: FactoryRun,
		controller: AbortController,
		task?: (signal: AbortSignal) => Promise<void>,
	): Promise<void> {
		try {
			if (task) await task(controller.signal);
			else
				await this.graph(
					run,
					run.workflow.steps,
					run.outputs,
					controller.signal,
					"",
				);
			controller.signal.throwIfAborted();
			run.status = "completed";
			this.log(run, "run", "Workflow complete. Ready for human review.");
		} catch (error) {
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
	): Promise<Record<string, unknown>> {
		let current: string | undefined = steps[0]?.id;
		const visits = new Map<string, number>();
		while (current && current !== "end") {
			signal.throwIfAborted();
			const step = steps.find((item) => item.id === current)!;
			const key = `${prefix}${step.id}`;
			const count = (visits.get(step.id) ?? 0) + 1;
			visits.set(step.id, count);
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
			};
			mkdirSync(context.evidenceDir, { recursive: true });
			let output: unknown;
			if (step.type === "fanout") {
				if (
					step.groups?.some((group) => group.some((item) => item.askQuestions))
				)
					throw new Error("Human checkpoints belong outside fanout branches");
				output = await Promise.all(
					(step.groups ?? []).map((group, index) =>
						this.graph(
							run,
							group,
							structuredClone(outputs),
							signal,
							`${key}/${index}/`,
						),
					),
				);
			} else {
				output = await this.hooks[step.type](context);
			}
			signal.throwIfAborted();
			outputs[step.id] = output;
			run.history.push({ step: key, output, at: new Date().toISOString() });
			this.save(run);
			if (step.askQuestions) {
				const questions = readPath(output, "questions");
				if (
					!Array.isArray(questions) ||
					questions.some((item) => typeof item !== "string")
				)
					throw new Error("Clarifier must return a questions array");
				if (questions.length) {
					await this.waitForAnswers(run, questions, signal);
					continue;
				}
			}
			const branch = step.branches.find(
				(candidate) =>
					JSON.stringify(readPath(output, candidate.when.path)) ===
					JSON.stringify(candidate.when.equals),
			);
			current = branch?.next ?? step.next ?? steps[steps.indexOf(step) + 1]?.id;
			this.log(run, key, `Finished ${step.name}`);
		}
		return outputs;
	}
	private async waitForAnswers(
		run: FactoryRun,
		questions: string[],
		signal: AbortSignal,
	): Promise<void> {
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
			await this.hooks.question?.(run);
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
	shutdown(): void {
		for (const id of this.controllers.keys()) this.stop(id);
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
